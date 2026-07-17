-- Add new notification preference columns for developer-specific email toggles
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS db_health_report BOOLEAN DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS payroll_report BOOLEAN DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS monthly_expense_report BOOLEAN DEFAULT TRUE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS termination_docs BOOLEAN DEFAULT TRUE;
