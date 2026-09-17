-- Run once against the live database, after 002_growth_os.sql (which
-- already adds marketers.role — including 'manager' — so this file only
-- adds the training-academy tracking table on top of it).
--
--   mysql -u USER -p DBNAME < db/migrations/007_telemarketer_training_academy.sql
--
-- New telemarketers must complete the training academy (see /training in
-- server.js) before reaching the normal app; field marketers and managers
-- are unaffected.

CREATE TABLE IF NOT EXISTS training_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketer_id INT NOT NULL UNIQUE,
  completed_modules JSON,
  roleplay_log JSON,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (marketer_id) REFERENCES marketers(id)
);
