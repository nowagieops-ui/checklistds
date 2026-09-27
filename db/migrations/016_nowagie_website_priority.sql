-- Adds website and priority info columns to nowagie_leads so the
-- Plymouth import data is visible to telemarketers in the Google Sheet.
--
--   mysql -u USER -p DBNAME < db/migrations/016_nowagie_website_priority.sql

ALTER TABLE nowagie_leads
  ADD COLUMN IF NOT EXISTS website VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS priority VARCHAR(100) NULL;
