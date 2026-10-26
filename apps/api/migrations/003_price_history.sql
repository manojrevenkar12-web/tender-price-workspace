-- Historical unit prices: the platform's memory of what work has cost.
--
-- A signature is one priced piece of work after text normalisation (domain/text.ts): its
-- content words, its attributes and its unit in the dimension's base unit. Prices are stored per
-- base unit (a price per t is stored per kg), as integer cents, with the quarter and region in
-- which they were bid and a pseudonymous company number. No organisation, tender or project
-- name is kept: what leaves this table is only ever a disclosure-controlled range.

CREATE TABLE price_signatures (
  id         serial PRIMARY KEY,
  unit_code  text NOT NULL,
  norm_key   text NOT NULL,
  norm_words text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}',
  sample     text NOT NULL,
  UNIQUE (unit_code, norm_key)
);
CREATE INDEX price_signatures_words ON price_signatures USING gin (norm_words gin_trgm_ops);

CREATE TABLE price_companies (
  id     serial PRIMARY KEY,
  org_id uuid UNIQUE
);

CREATE TABLE price_points (
  signature_id     int NOT NULL REFERENCES price_signatures (id),
  company_id       int NOT NULL REFERENCES price_companies (id),
  quarter          text NOT NULL,
  region           text NOT NULL,
  unit_price_cents int NOT NULL CHECK (unit_price_cents > 0),
  source_tender    uuid
);
-- Covering index: a benchmark reads only this index (index-only scan) for its signatures.
CREATE INDEX price_points_signature ON price_points (signature_id) INCLUDE (company_id, quarter, region, unit_price_cents, source_tender);

-- Construction price index by quarter (2021 = 100) and regional price levels, both used to
-- bring a historical price to the tender's date and place.
CREATE TABLE price_index (
  quarter text PRIMARY KEY,
  value   numeric(7, 2) NOT NULL
);
CREATE TABLE region_factors (
  region      text PRIMARY KEY,
  factor      numeric(6, 4) NOT NULL,
  signatures  int NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Market ranges per position of a BoQ version, computed by the worker when the version is
-- created and read by the price comparison.
CREATE TABLE position_benchmarks (
  tender_id    uuid NOT NULL,
  version      int NOT NULL,
  oz           text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok', 'suppressed', 'not_comparable')),
  reason       text,
  p10          int,
  p25          int,
  p50          int,
  p75          int,
  p90          int,
  points       int NOT NULL DEFAULT 0,
  companies    int NOT NULL DEFAULT 0,
  signatures   int NOT NULL DEFAULT 0,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tender_id, version, oz),
  FOREIGN KEY (tender_id, version, oz) REFERENCES boq_positions (tender_id, version, oz) ON DELETE CASCADE
);
ALTER TABLE position_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_benchmarks FORCE ROW LEVEL SECURITY;
-- Market ranges are for the buyer only; bidders never see them.
CREATE POLICY position_benchmarks_owner ON position_benchmarks FOR SELECT USING (app_system() OR owns_tender(tender_id));
CREATE POLICY position_benchmarks_system ON position_benchmarks FOR ALL USING (app_system()) WITH CHECK (app_system());

-- Jobs for the worker: claimed with FOR UPDATE SKIP LOCKED, retried with backoff.
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts    int NOT NULL DEFAULT 0,
  run_after   timestamptz NOT NULL DEFAULT now(),
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_ready ON jobs (run_after) WHERE status = 'queued';
