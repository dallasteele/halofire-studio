-- HaloFire supplies DB schema. Idempotent — run on every db.open().
-- One file: supplies.duckdb. Append-only prices; latest-view feeds BOM.

-- Sequences first — they're referenced by DEFAULT on the tables below.
CREATE SEQUENCE IF NOT EXISTS prices_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sync_runs_seq START 1;

CREATE TABLE IF NOT EXISTS suppliers (
  id            TEXT PRIMARY KEY,           -- e.g. 'victaulic'
  name          TEXT NOT NULL,
  website       TEXT,
  price_sheet_url TEXT,                     -- URL the sync agent scrapes
  strategy      TEXT,                       -- 'pdf_table', 'html_list', 'csv_feed', 'manual'
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parts (
  sku           TEXT PRIMARY KEY,           -- stable id (also GLB stem where available)
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,              -- matches @halofire/catalog ComponentCategory
  mounting      TEXT,
  manufacturer  TEXT,
  supplier_id   TEXT REFERENCES suppliers(id),
  model         TEXT,
  -- Nominal dims, inches, k-factor — stored flat for easy Excel editing
  dim_l_cm      DOUBLE,
  dim_d_cm      DOUBLE,
  dim_h_cm      DOUBLE,
  pipe_size_in  DOUBLE,
  k_factor      DOUBLE,
  temp_rating_f INTEGER,
  response      TEXT,                       -- 'fast' | 'standard'
  connection    TEXT,                       -- 'npt' | 'grooved' | 'flanged' | 'solvent_weld'
  finish        TEXT,
  nfpa_paint_hex TEXT,                      -- null when no regulatory color
  open_source_glb BOOLEAN DEFAULT FALSE,
  discontinued  BOOLEAN DEFAULT FALSE,
  notes         TEXT,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Append-only price log. Never UPDATE — always INSERT.
CREATE TABLE IF NOT EXISTS prices (
  id              BIGINT DEFAULT nextval('prices_seq'),
  sku             TEXT NOT NULL REFERENCES parts(sku),
  unit_cost_usd   DECIMAL(10, 4) NOT NULL,   -- 4 decimals: fittings can be fractional cents
  unit            TEXT DEFAULT 'ea',         -- 'ea' | 'ft' | 'm' | 'lb' | '100ft' | 'each_100'
  observed_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source          TEXT NOT NULL,             -- 'sync_agent:victaulic:2026-04', 'manual', 'bid:1881'
  source_doc_sha256 TEXT,                    -- hash of source PDF/CSV for audit
  confidence      DOUBLE DEFAULT 1.0,        -- 0..1; LLM-parsed prices < 1.0
  currency        TEXT DEFAULT 'USD',
  PRIMARY KEY (id)
);

-- Convenience view: latest observation per SKU
CREATE OR REPLACE VIEW latest_prices AS
SELECT
  p.sku,
  p.unit_cost_usd,
  p.unit,
  p.observed_at,
  p.source,
  p.confidence,
  p.currency
FROM prices p
JOIN (
  SELECT sku, MAX(observed_at) AS max_ts
  FROM prices
  GROUP BY sku
) m ON m.sku = p.sku AND m.max_ts = p.observed_at;

-- Every sync attempt — for audit + debugging
CREATE TABLE IF NOT EXISTS sync_runs (
  id              BIGINT DEFAULT nextval('sync_runs_seq'),
  started_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at     TIMESTAMP,
  supplier_id     TEXT REFERENCES suppliers(id),
  source_url      TEXT,
  source_doc_sha256 TEXT,
  parts_touched   INTEGER DEFAULT 0,
  prices_added    INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending',    -- 'pending' | 'success' | 'failed'
  error           TEXT,
  llm_model       TEXT,
  PRIMARY KEY (id)
);

-- Freshness: SKUs whose latest price is older than N days
CREATE OR REPLACE VIEW stale_skus AS
SELECT
  p.sku,
  lp.observed_at AS last_priced_at,
  DATE_DIFF('day', lp.observed_at, CURRENT_TIMESTAMP) AS days_stale
FROM parts p
LEFT JOIN latest_prices lp ON lp.sku = p.sku
WHERE lp.observed_at IS NULL
   OR lp.observed_at < CURRENT_TIMESTAMP - INTERVAL 60 DAY;
