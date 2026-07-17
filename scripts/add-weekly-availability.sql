-- Add week_start column to barber_availability for per-week scheduling
-- week_start = '1970-01-01' means default/template hours
-- week_start = actual Monday date means override for that specific week

ALTER TABLE barber_availability ADD COLUMN IF NOT EXISTS week_start DATE NOT NULL DEFAULT '1970-01-01';

-- Drop old unique constraint and add new one including week_start
ALTER TABLE barber_availability DROP CONSTRAINT IF EXISTS barber_availability_barber_id_day_of_week_key;
ALTER TABLE barber_availability ADD CONSTRAINT barber_availability_barber_day_week_key UNIQUE (barber_id, day_of_week, week_start);
