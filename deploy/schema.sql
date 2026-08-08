-- Run this in the Supabase SQL editor before first use.

CREATE TABLE IF NOT EXISTS inspections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz DEFAULT now(),
  device_id     text NOT NULL,
  meat_type     text NOT NULL,          -- 'chicken' | 'pork' | 'beef'
  avg_nh3_ppm   numeric(8,3),
  avg_h2s_ppm   numeric(8,3),
  gas_result    text,                   -- 'fresh' | 'spoiled' | 'invalid'
  raw_readings  jsonb,                  -- array of {timestamp, nh3, h2s}
  upload_source text DEFAULT 'kiosk'
);

-- Enable Realtime on this table (Module 5.6) via the Supabase dashboard:
-- Database > Replication > toggle "inspections" on, or:
ALTER PUBLICATION supabase_realtime ADD TABLE inspections;
