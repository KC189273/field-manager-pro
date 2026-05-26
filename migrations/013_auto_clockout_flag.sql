-- Add auto_clock_out to the flags type CHECK constraint
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT constraint_name INTO con_name
  FROM information_schema.table_constraints
  WHERE table_name = 'flags' AND constraint_type = 'CHECK'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE flags DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE flags ADD CONSTRAINT flags_type_check CHECK (type IN (
  'missing_clock_out',
  'missing_clock_in',
  'no_activity',
  'overtime',
  'schedule_no_opener',
  'schedule_no_closer',
  'schedule_gap',
  'schedule_overlap',
  'schedule_overtime',
  'break_long',
  'break_multiple',
  'time_off_request',
  'auto_clock_out'
));
