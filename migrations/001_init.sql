-- marketplace-mcp: base schema (stage 1 — Core)
CREATE TABLE IF NOT EXISTS marketplace_connections (
    connection_id UUID PRIMARY KEY,
    marketplace   TEXT NOT NULL CHECK (marketplace IN ('wildberries','ozon','yandex_market')),
    name          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    mock          BOOLEAN NOT NULL DEFAULT FALSE,
    -- Connection points at the marketplace sandbox rather than production.
    sandbox       BOOLEAN NOT NULL DEFAULT FALSE,
    permissions   JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Secrets: AES-256-GCM ciphertext only (see src/core/secrets.ts); the key lives outside the DB.
CREATE TABLE IF NOT EXISTS marketplace_credentials (
    connection_id        UUID NOT NULL REFERENCES marketplace_connections(connection_id) ON DELETE CASCADE,
    cred_key             TEXT NOT NULL,
    cred_value_encrypted TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (connection_id, cred_key)
);

-- Tool call audit (spec §32). No secrets here by design.
CREATE TABLE IF NOT EXISTS tool_calls (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    tool          TEXT NOT NULL,
    marketplace   TEXT,
    connection_id UUID,
    duration_ms   INTEGER NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('ok','error')),
    error_code    TEXT,
    client        TEXT
);
CREATE INDEX IF NOT EXISTS tool_calls_ts_idx ON tool_calls (ts);
CREATE INDEX IF NOT EXISTS tool_calls_conn_idx ON tool_calls (connection_id, ts);

-- History (stage 5) — price/stock snapshots; collectors arrive as a separate worker.
CREATE TABLE IF NOT EXISTS price_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    connection_id UUID NOT NULL,
    seller_sku    TEXT,
    marketplace_product_id TEXT,
    price_amount  NUMERIC(14,2) NOT NULL,
    currency      TEXT NOT NULL DEFAULT 'RUB',
    discount_percent NUMERIC(5,2)
);
CREATE INDEX IF NOT EXISTS price_snapshots_idx ON price_snapshots (connection_id, seller_sku, ts);

CREATE TABLE IF NOT EXISTS stock_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    connection_id UUID NOT NULL,
    seller_sku    TEXT,
    warehouse     TEXT,
    fulfillment_model TEXT,
    available     INTEGER NOT NULL DEFAULT 0,
    reserved      INTEGER NOT NULL DEFAULT 0,
    in_transit    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS stock_snapshots_idx ON stock_snapshots (connection_id, seller_sku, ts);
