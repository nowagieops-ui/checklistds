-- Run once against the live database BEFORE turning on the Google Sheet
-- sync (services/sheetsSync.js). Purely additive.
--
--   mysql -u USER -p DBNAME < db/migrations/009_google_sheet_sync.sql
--
-- Requires MySQL 8.0.29+ for ADD COLUMN IF NOT EXISTS (same as 002).

-- Where a logged contact came from, and the short call outcome
-- ("No answer", "Reached", ...) that the spreadsheet captures but the
-- in-app follow-up form doesn't. Existing rows default to source 'app'.
ALTER TABLE followups
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'app';

-- One row per lead that has ever been on the sheet. The two hashes are the
-- sheet's values as of the last sync, so the next run can tell what she
-- changed since (lead details vs. the call-log block) instead of re-logging
-- the same call every few minutes. A row staying here after its sheet row is
-- deleted is deliberate: it stops the sync re-adding a lead someone removed.
CREATE TABLE IF NOT EXISTS sheet_sync_rows (
  rider_id INT PRIMARY KEY,
  lead_hash VARCHAR(40) NOT NULL,
  call_hash VARCHAR(40) NOT NULL,
  last_synced_at DATETIME NOT NULL,
  FOREIGN KEY (rider_id) REFERENCES riders(id)
);
