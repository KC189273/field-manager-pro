-- Interactive support troubleshooter conversations
CREATE TABLE IF NOT EXISTS support_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID,
  user_id          UUID NOT NULL,
  user_name        TEXT,
  user_role        TEXT,
  industry         TEXT,
  status           TEXT NOT NULL DEFAULT 'active',
  escalated_to     TEXT,
  escalation_reason TEXT,
  turn_count       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS support_conversation_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  body             TEXT NOT NULL,
  tool_calls       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_conv_user ON support_conversations (user_id, status);
CREATE INDEX IF NOT EXISTS idx_support_conv_msgs ON support_conversation_messages (conversation_id, created_at);
