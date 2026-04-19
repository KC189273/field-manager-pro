-- Per-org launch date for payroll enforcement
-- When NULL: payroll workflow is available for testing but cron reminders are suppressed
-- When set: all periods on or after that date trigger automated reminders and tasks
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS payroll_launch_date DATE;
