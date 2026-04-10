-- ============================================================
-- DM Store Visit Checklist — run once in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS dm_store_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address    TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dm_store_visits (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID,
  submitted_by_id           UUID NOT NULL,
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Visit Details
  store_location_id         UUID REFERENCES dm_store_locations(id),
  store_address             TEXT NOT NULL,
  employees_working         TEXT NOT NULL,
  dm_name                   TEXT NOT NULL,
  assigned_rdm              TEXT NOT NULL,
  reason_for_visit          TEXT NOT NULL,
  additional_comments       TEXT,

  -- Pre-Visit Planning
  pre_visit_1               TEXT NOT NULL,
  pre_visit_2               TEXT NOT NULL,
  pre_visit_3               TEXT NOT NULL,

  -- Scorecard Review
  scorecard_grade           TEXT NOT NULL,
  scorecard_1               TEXT NOT NULL,
  scorecard_2               TEXT NOT NULL,
  scorecard_3               TEXT NOT NULL,

  -- Sales Interaction
  live_interaction_observed BOOLEAN NOT NULL,

  -- HEART Sales Model (null when no live interaction)
  heart_hello               BOOLEAN,
  heart_engage              BOOLEAN,
  heart_assess              BOOLEAN,
  heart_recommend           BOOLEAN,
  heart_thank               BOOLEAN,

  -- Sales Process Execution (null when no live interaction)
  sales_process_1           BOOLEAN,
  sales_process_2           BOOLEAN,
  sales_process_3           BOOLEAN,
  sales_evaluation_comments TEXT,

  -- Operations Quick Check
  ops_check_1               BOOLEAN NOT NULL,
  ops_check_2               BOOLEAN NOT NULL,
  ops_check_3               BOOLEAN NOT NULL,
  ops_check_4               BOOLEAN NOT NULL,
  ops_check_5               BOOLEAN NOT NULL,
  ops_notes                 TEXT,

  -- Coaching
  coaching_1                TEXT NOT NULL,
  coaching_2                TEXT NOT NULL,
  coaching_3                TEXT NOT NULL,

  -- Impact & Commitments
  impact_1                  TEXT NOT NULL,
  impact_2                  TEXT NOT NULL,
  impact_3                  TEXT NOT NULL,
  impact_4                  TEXT NOT NULL,

  -- Additional
  cc_emails                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_dm_store_visits_org_id       ON dm_store_visits(org_id);
CREATE INDEX IF NOT EXISTS idx_dm_store_visits_submitted_by ON dm_store_visits(submitted_by_id);
CREATE INDEX IF NOT EXISTS idx_dm_store_visits_submitted_at ON dm_store_visits(submitted_at);

-- ============================================================
-- SEED: Replace with your actual store addresses
-- ============================================================
INSERT INTO dm_store_locations (address) VALUES
  ('Store Address 1'),
  ('Store Address 2'),
  ('Store Address 3');
-- Add all 45 store addresses above, one per line
