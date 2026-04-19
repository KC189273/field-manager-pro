-- Per-DM SR approval tracking (download required before approve)
CREATE TABLE IF NOT EXISTS payroll_sr_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  dm_id UUID NOT NULL REFERENCES users(id),
  sr_user_id UUID REFERENCES users(id),
  downloaded_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  UNIQUE(period_id, dm_id)
);

-- Final submission tracking on payroll_periods
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS final_submitted_at TIMESTAMPTZ;
ALTER TABLE payroll_periods ADD COLUMN IF NOT EXISTS final_submitted_by UUID REFERENCES users(id);
