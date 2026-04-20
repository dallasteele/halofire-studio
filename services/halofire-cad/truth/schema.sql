-- Halo historical bid truth schema — the reference every cruel
-- test compares our output against. Same pattern as pricing/supplies.
-- Idempotent; safe to re-run on open_db().

CREATE SEQUENCE IF NOT EXISTS corrections_seq START 1;

CREATE TABLE IF NOT EXISTS bids_truth (
  project_id          TEXT PRIMARY KEY,
  project_name        TEXT,
  architect_pdf_path  TEXT,
  as_built_pdf_path   TEXT,
  permit_reviewed     BOOLEAN DEFAULT FALSE,
  -- Counts Halo actually submitted / installed
  total_bid_usd       DECIMAL(12, 2),
  head_count          INTEGER,
  pipe_count          INTEGER,
  pipe_total_ft       DECIMAL(10, 1),
  system_count        INTEGER,
  level_count         INTEGER,
  -- Hydraulic numbers from the approved calc
  hydraulic_gpm       DECIMAL(10, 1),
  hydraulic_psi       DECIMAL(10, 1),
  signed_off_at       DATE,
  notes               TEXT,
  loaded_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bids_level_truth (
  project_id          TEXT NOT NULL,
  level_index         INTEGER NOT NULL,
  level_name          TEXT,
  use_class           TEXT,        -- 'residential', 'retail', 'garage', …
  elevation_m         DECIMAL(6, 2),
  -- Outer-boundary polygon as WKT so shapely can re-hydrate it
  outline_polygon_wkt TEXT,
  area_sqm            DECIMAL(10, 1),
  room_count          INTEGER,
  head_count          INTEGER,
  hazard_class        TEXT,        -- NFPA 13 hazard at sheet level
  PRIMARY KEY (project_id, level_index)
);

-- Every Wade / AHJ / PE red-line becomes a row. Each row links to
-- a failing regression test so the fix is trackable.
CREATE TABLE IF NOT EXISTS bids_corrections (
  correction_id       BIGINT DEFAULT nextval('corrections_seq'),
  project_id          TEXT NOT NULL,
  reviewer            TEXT NOT NULL,   -- 'wade', 'ahj', 'pe_X'
  symptom             TEXT NOT NULL,
  fix                 TEXT,
  test_id             TEXT,            -- path to the regression test
  severity            TEXT DEFAULT 'style', -- 'blocker' | 'code' | 'style'
  opened_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at           TIMESTAMP,
  PRIMARY KEY (correction_id)
);

-- Summary view used by cruel tests
CREATE OR REPLACE VIEW open_corrections AS
SELECT
  project_id,
  COUNT(*)              AS open_count,
  SUM(CASE WHEN severity = 'blocker' THEN 1 ELSE 0 END) AS blocker_count,
  SUM(CASE WHEN severity = 'code' THEN 1 ELSE 0 END)    AS code_count,
  MAX(opened_at)        AS latest_opened
FROM bids_corrections
WHERE closed_at IS NULL
GROUP BY project_id;
