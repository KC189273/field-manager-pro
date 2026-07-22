-- Agent Crew: Phase 0 — Foundation tables
-- Every agent execution, for cost + audit
CREATE TABLE IF NOT EXISTS agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent         TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  summary       TEXT,
  input_tokens  INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cost_usd      NUMERIC(10,4) DEFAULT 0,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

-- The review queue. Every customer-facing action lands here.
CREATE TABLE IF NOT EXISTS agent_actions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID REFERENCES agent_runs(id),
  agent         TEXT NOT NULL,
  type          TEXT NOT NULL,
  risk_level    TEXT NOT NULL DEFAULT 'high',
  status        TEXT NOT NULL DEFAULT 'pending',
  account_id    UUID,
  target_email  TEXT,
  subject       TEXT,
  body          TEXT,
  payload       JSONB,
  reason        TEXT,
  reviewed_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at   TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ,
  result        TEXT
);

-- Persistent per-entity memory so agents remember context
CREATE TABLE IF NOT EXISTS agent_memory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent        TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    UUID NOT NULL,
  key          TEXT NOT NULL,
  value        JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent, entity_type, entity_id, key)
);

-- Daily health snapshot per account (Health Agent output, internal)
CREATE TABLE IF NOT EXISTS account_health (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL,
  score              INT NOT NULL,
  status             TEXT NOT NULL,
  active_users_7d    INT,
  last_activity_at   TIMESTAMPTZ,
  signals            JSONB,
  snapshot_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_status ON agent_actions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_account_health_acct ON account_health (account_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memory_lookup ON agent_memory (agent, entity_type, entity_id);
