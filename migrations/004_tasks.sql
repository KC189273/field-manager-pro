-- ============================================================
-- Assigned Task / Checklist System
-- Run in Supabase SQL Editor after 003_scheduled_shifts.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID,
  week_start   DATE NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  assignee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_completions (
  task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  completed_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note           TEXT,
  photo_key      TEXT,
  PRIMARY KEY (task_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_org_week  ON tasks(org_id, week_start);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee  ON tasks(assignee_id, week_start);
