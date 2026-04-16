-- Add optional due date to tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE;
