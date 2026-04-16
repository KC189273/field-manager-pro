CREATE TABLE IF NOT EXISTS payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_dm',
  sr_approved_by UUID REFERENCES users(id),
  sr_approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, period_start)
);

CREATE TABLE IF NOT EXISTS payroll_dm_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  dm_id UUID NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(period_id, dm_id)
);
