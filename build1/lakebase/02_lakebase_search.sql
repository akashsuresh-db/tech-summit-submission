-- Build 1 · Lakebase Search — native hybrid (vector + full-text/BM25) over app.products.
--
-- Uses Databricks Lakebase Search (Beta): the lakebase_vector + lakebase_text extensions,
-- with a lakebase_ann vector index and a lakebase_bm25 full-text index, fused with
-- Reciprocal Rank Fusion. Retrieval never leaves the customer's Lakebase account.
-- Powers the Build-2 app's `search_products` cross-sell tool.
--
-- Enablement (once, in the project UI): project Settings -> Enable Lakebase Search
-- (restarts computes, loads lakebase_* into shared_preload_libraries). Then:

CREATE EXTENSION IF NOT EXISTS lakebase_vector CASCADE;   -- pulls in pgvector
CREATE EXTENSION IF NOT EXISTS lakebase_text;

-- Full-text: generated tsvector over product name + description.
ALTER TABLE app.products
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
        GENERATED ALWAYS AS (
            to_tsvector('english', coalesce(product_name,'') || ' ' || coalesce(description,''))
        ) STORED;

-- Vector: 1024-dim databricks-gte-large-en embedding of "<name>. <description>"
-- (populated by build_search_index.py via Model Serving).
ALTER TABLE app.products ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- Indexes (create AFTER embeddings are populated):
--   CREATE INDEX products_ann  ON app.products USING lakebase_ann  (embedding vector_cosine_ops);
--   CREATE INDEX products_bm25 ON app.products USING lakebase_bm25 (search_tsv);

-- Hybrid search (Reciprocal Rank Fusion) for a natural-language query, given its
-- 1024-dim embedding as $query_vec and the raw text as $query_text:
--
--   WITH vector_ranked AS (
--     SELECT product_id, RANK() OVER (ORDER BY dist) AS rank FROM (
--       SELECT product_id, embedding <=> :query_vec AS dist
--       FROM app.products WHERE embedding IS NOT NULL ORDER BY dist LIMIT 40) v),
--   keyword_ranked AS (
--     SELECT product_id, RANK() OVER (ORDER BY score) AS rank FROM (
--       SELECT product_id,
--              search_tsv <@> to_bm25query(to_tsvector('english', :query_text), 'app.products_bm25') AS score
--       FROM app.products ORDER BY score LIMIT 40) k)
--   SELECT p.product_id, p.product_name, p.segment,
--          COALESCE(1.0/(60+v.rank),0) + COALESCE(1.0/(60+k.rank),0) AS rrf_score
--   FROM app.products p
--   LEFT JOIN vector_ranked v USING (product_id)
--   LEFT JOIN keyword_ranked k USING (product_id)
--   WHERE v.product_id IS NOT NULL OR k.product_id IS NOT NULL
--   ORDER BY rrf_score DESC, p.product_id LIMIT 5;
