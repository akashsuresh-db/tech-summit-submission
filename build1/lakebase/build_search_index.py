#!/usr/bin/env python3
"""Build 1 · Lakebase Search — populate embeddings, build indexes, run a hybrid query.

1. Adds the search_tsv + embedding columns (via 02_lakebase_search.sql, already applied).
2. Embeds "<product_name>. <description>" for every product with databricks-gte-large-en
   (Model Serving) and stores the 1024-dim vector in app.products.embedding.
3. Creates the lakebase_ann (vector) + lakebase_bm25 (full-text) indexes.
4. Runs a natural-language hybrid search (Reciprocal Rank Fusion) and prints the ranked
   products — retrieval stays entirely inside the Lakebase account.

Usage:
  python lakebase/build_search_index.py --profile fe-vm-akash-fevm-ts \
      --query "wealth advisory account for an affluent long-tenure customer"
"""
import argparse, json, subprocess
import psycopg
from databricks.sdk import WorkspaceClient

EMBED_ENDPOINT = "databricks-gte-large-en"


def cli_json(a):
    return json.loads(subprocess.run(a, capture_output=True, text=True).stdout)


def pg(profile, project, branch, endpoint):
    base = f"projects/{project}/branches/{branch}"
    host = cli_json(["databricks","postgres","list-endpoints",base,"-p",profile,"-o","json"])[0]["status"]["hosts"]["host"]
    token = cli_json(["databricks","postgres","generate-database-credential",f"{base}/endpoints/{endpoint}","-p",profile,"-o","json"])["token"]
    email = cli_json(["databricks","current-user","me","-p",profile,"-o","json"])["userName"]
    return psycopg.connect(host=host, port=5432, dbname="databricks_postgres", user=email,
                           password=token, sslmode="require", autocommit=True)


def embed(w, texts):
    r = w.serving_endpoints.query(EMBED_ENDPOINT, input=texts)
    return [d["embedding"] if isinstance(d, dict) else d.embedding for d in r.data]


def vlit(vec):
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--project", default="meridian-bank")
    ap.add_argument("--branch", default="production")
    ap.add_argument("--endpoint", default="primary")
    ap.add_argument("--query", default="wealth advisory account for an affluent long-tenure customer")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    w = WorkspaceClient(profile=a.profile)
    conn = pg(a.profile, a.project, a.branch, a.endpoint); cur = conn.cursor()

    # 1) embed + store product vectors
    cur.execute("SELECT product_id, product_name, coalesce(description,'') FROM app.products ORDER BY product_id")
    rows = cur.fetchall()
    texts = [f"{name}. {desc}" for _, name, desc in rows]
    vecs = embed(w, texts)
    for (pid, _, _), v in zip(rows, vecs):
        cur.execute("UPDATE app.products SET embedding = %s::vector WHERE product_id = %s", (vlit(v), pid))
    print(f"embedded {len(rows)} products")

    # 2) build native Lakebase Search indexes
    cur.execute("CREATE INDEX IF NOT EXISTS products_ann  ON app.products USING lakebase_ann  (embedding vector_cosine_ops)")
    cur.execute("CREATE INDEX IF NOT EXISTS products_bm25 ON app.products USING lakebase_bm25 (search_tsv)")
    print("created lakebase_ann + lakebase_bm25 indexes")

    # 3) hybrid RRF search for the NL query
    qvec = vlit(embed(w, [a.query])[0])
    hybrid = """
        WITH vector_ranked AS (
          SELECT product_id, RANK() OVER (ORDER BY dist) AS rank FROM (
            SELECT product_id, embedding <=> %(qv)s::vector AS dist
            FROM app.products WHERE embedding IS NOT NULL ORDER BY dist LIMIT 40) v),
        keyword_ranked AS (
          SELECT product_id, RANK() OVER (ORDER BY score) AS rank FROM (
            SELECT product_id,
                   search_tsv <@> to_bm25query(to_tsvector('english', %(qt)s), 'app.products_bm25') AS score
            FROM app.products ORDER BY score LIMIT 40) k)
        SELECT p.product_id, p.product_name, p.segment, p.product_type,
               v.rank AS vector_rank, k.rank AS keyword_rank,
               round((COALESCE(1.0/(60+v.rank),0) + COALESCE(1.0/(60+k.rank),0))::numeric, 6) AS rrf_score
        FROM app.products p
        LEFT JOIN vector_ranked v USING (product_id)
        LEFT JOIN keyword_ranked k USING (product_id)
        WHERE v.product_id IS NOT NULL OR k.product_id IS NOT NULL
        ORDER BY rrf_score DESC, p.product_id LIMIT 5;
    """
    cur.execute(hybrid, {"qv": qvec, "qt": a.query})
    cols = [d.name for d in cur.description]
    results = [dict(zip(cols, r)) for r in cur.fetchall()]
    for r in results:
        r["rrf_score"] = float(r["rrf_score"])
    print(json.dumps(results, indent=2, default=str))

    if a.out:
        json.dump({"query": a.query, "endpoint": EMBED_ENDPOINT, "method": "hybrid RRF (lakebase_ann + lakebase_bm25)",
                   "results": results}, open(a.out, "w"), indent=2, default=str)
        print(f"wrote {a.out}")
    cur.close(); conn.close()


if __name__ == "__main__":
    main()
