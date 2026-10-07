-- Tracks, per rider sheet stage tab, how many weekly WhatsApp follow-up
-- columns have been inserted and which week was last added. Inserting a
-- column is a structural change to a live sheet people are typing into, so
-- "have I already done this week's insert" needs a source of truth that
-- can't drift out of sync with the sheet itself (re-deriving it from the
-- sheet's own text every run was the fragile alternative).
--
--   mysql -u USER -p DBNAME < db/migrations/017_sheet_weekly_tracker.sql

CREATE TABLE IF NOT EXISTS sheet_weekly_tracker (
  tab_id VARCHAR(10) NOT NULL PRIMARY KEY,
  week_columns INT NOT NULL DEFAULT 0,
  last_week_start DATE NULL
);
