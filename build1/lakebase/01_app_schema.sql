-- Build 1 · Lakebase — operational schema for the Meridian Relationship Desk
-- Target: Lakebase Autoscaling project projects/meridian-bank, branch production,
--         database databricks_postgres, schema app.
-- Matches app/server/db/schema.ts (Drizzle) column-for-column so the Build 2 app
-- runs against these tables unchanged.
--
-- Two groups of tables:
--   * Synced READ-ONLY mirrors of the governed UC Delta gold tables
--     (customer_position, open_atrisk, nba_recommendations, products) — the app
--     only SELECTs these; they are refreshed from Delta by sync_from_delta.py.
--   * The single WRITABLE operational table (rm_actions) + chat state
--     (conversations, messages, feedback) that the app writes to.

CREATE SCHEMA IF NOT EXISTS app;

-- ===========================================================================
-- Chat state (writable)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS app.conversations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email  TEXT NOT NULL,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'default',   -- 'default' | 'demo_dock'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON app.conversations (user_email, updated_at);
CREATE INDEX IF NOT EXISTS conversations_kind_idx ON app.conversations (user_email, kind);

CREATE TABLE IF NOT EXISTS app.messages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
    role             TEXT NOT NULL,                 -- 'user' | 'assistant' | 'system'
    content          TEXT NOT NULL,
    position         INTEGER NOT NULL,
    trace_id         TEXT,
    thinking         JSONB NOT NULL DEFAULT '[]'::jsonb,
    error            TEXT,
    canceled         BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_convo_pos_uq ON app.messages (conversation_id, position);

CREATE TABLE IF NOT EXISTS app.feedback (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id             UUID NOT NULL REFERENCES app.messages(id) ON DELETE CASCADE,
    user_email             TEXT NOT NULL,
    value                  TEXT NOT NULL,           -- 'up' | 'down'
    rationale              TEXT,
    trace_id               TEXT,
    mlflow_assessment_id   TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_message_idx ON app.feedback (message_id);

-- ===========================================================================
-- Synced READ-ONLY mirrors of governed UC Delta gold tables
--   Source of truth: akash_fevm_ts_catalog.meridian_bank.<table>
--   Refreshed by sync_from_delta.py (bulk COPY). The app never writes these.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS app.customer_position (
    customer_id                  TEXT PRIMARY KEY,
    tier                         TEXT NOT NULL,     -- mass | mass_affluent | affluent | private
    tenure_years                 INTEGER,
    home_metro                   TEXT,
    customer_lat                 DOUBLE PRECISION,
    customer_lng                 DOUBLE PRECISION,
    profile_summary              TEXT,
    attrition_risk_score         DOUBLE PRECISION,
    balance_outflow_30d_usd      DOUBLE PRECISION,
    churn_signal_score           DOUBLE PRECISION,
    total_balance_usd            DOUBLE PRECISION,
    deposit_balance_usd          DOUBLE PRECISION,
    affected_deposit_balance_usd DOUBLE PRECISION,
    min_days_to_maturity         INTEGER,
    product_count                INTEGER,
    balance_at_risk_usd          DOUBLE PRECISION,
    revenue_at_risk_usd          DOUBLE PRECISION,
    risk_band                    TEXT NOT NULL      -- critical | elevated | watch | healthy
);

CREATE TABLE IF NOT EXISTS app.open_atrisk (
    customer_id                     TEXT PRIMARY KEY,
    attrition_risk_score            DOUBLE PRECISION,
    balance_at_risk_usd             DOUBLE PRECISION,
    revenue_at_risk_usd             DOUBLE PRECISION,
    atrisk_product_id               TEXT,
    atrisk_balance_usd              DOUBLE PRECISION,
    days_to_maturity                INTEGER,
    current_rate_apy                DOUBLE PRECISION,
    candidate_cross_sell_product_id TEXT
);

CREATE TABLE IF NOT EXISTS app.nba_recommendations (
    customer_id                   TEXT PRIMARY KEY,
    recommended_action            TEXT NOT NULL,    -- retention_offer | cross_sell | rm_outreach
    recommended_offer_product_id  TEXT,
    recommended_rate_apy          DOUBLE PRECISION,
    predicted_retained_usd        DOUBLE PRECISION,
    predicted_net_value_usd       DOUBLE PRECISION,
    action_ranking                JSONB NOT NULL DEFAULT '[]'::jsonb,
    scored_at                     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app.products (
    product_id      TEXT PRIMARY KEY,
    product_name    TEXT NOT NULL,
    product_type    TEXT,
    segment         TEXT,
    rate_apy        DOUBLE PRECISION,
    min_balance_usd DOUBLE PRECISION,
    description     TEXT,               -- searchable text (Lakebase Search target)
    is_active       BOOLEAN
);

-- ===========================================================================
-- Writable operational table — the ONLY table the app writes to
-- ===========================================================================
CREATE TABLE IF NOT EXISTS app.rm_actions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id            TEXT NOT NULL,
    action_type            TEXT NOT NULL,           -- retention_offer | cross_sell | rm_outreach
    offered_product_id     TEXT,
    rate_apy               DOUBLE PRECISION,
    drafted_note           TEXT,
    predicted_retained_usd DOUBLE PRECISION,
    status                 TEXT NOT NULL DEFAULT 'proposed',  -- proposed|approved|executed|overridden
    approved_by            TEXT,
    audit_trail            JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS rm_actions_customer_idx ON app.rm_actions (customer_id, created_at DESC);
