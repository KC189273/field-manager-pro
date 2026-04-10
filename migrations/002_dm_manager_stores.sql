-- ============================================================
-- DM Manager → Store Assignments
-- Run once in Supabase SQL Editor after 001_dm_store_visits.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS dm_manager_stores (
  manager_id        UUID NOT NULL,
  store_location_id UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
  PRIMARY KEY (manager_id, store_location_id)
);

CREATE INDEX IF NOT EXISTS idx_dm_manager_stores_manager ON dm_manager_stores(manager_id);
