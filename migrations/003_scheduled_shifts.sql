-- ============================================================
-- Staff Scheduling — Manager-authored shifts per store per week
-- Run in Supabase SQL Editor after 002_dm_manager_stores.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS scheduled_shifts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID,
  store_location_id UUID NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date        DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  role_note         TEXT,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_end_after_start CHECK (end_time > start_time)
);

-- Tracks which (store, week) pairs have been published to employees.
-- A row existing = published. The week_start column is always a Monday.
CREATE TABLE IF NOT EXISTS scheduled_shifts_publish (
  store_location_id UUID    NOT NULL REFERENCES dm_store_locations(id) ON DELETE CASCADE,
  week_start        DATE    NOT NULL,
  published_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (store_location_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_store_date
  ON scheduled_shifts(store_location_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_employee_date
  ON scheduled_shifts(employee_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_org
  ON scheduled_shifts(org_id);
CREATE INDEX IF NOT EXISTS idx_ssp_week_start
  ON scheduled_shifts_publish(week_start);
