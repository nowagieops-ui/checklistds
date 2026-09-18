-- Run once against the live database. Adds tracking for the ongoing
-- 12-week telemarketer training program (weeks 2-12) that runs alongside
-- normal work, separate from the Week 1 training_progress table (which
-- stays as the one-time hard gate before a telemarketer reaches /home).
--
--   mysql -u USER -p DBNAME < db/migrations/008_weekly_training_program.sql

CREATE TABLE IF NOT EXISTS training_weeks_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketer_id INT NOT NULL,
  week_number INT NOT NULL,
  completed_modules JSON,
  roleplay_log JSON,
  started_at DATETIME,
  completed_at DATETIME,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_marketer_week (marketer_id, week_number),
  FOREIGN KEY (marketer_id) REFERENCES marketers(id)
);
