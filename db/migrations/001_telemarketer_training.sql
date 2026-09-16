-- Run this once against the LIVE database (the one db/schema.sql already
-- ran against) to add telemarketer role support and training-academy
-- tracking. Purely additive — does not touch existing rows.
--
--   mysql -u USER -p DBNAME < db/migrations/001_telemarketer_training.sql
--
-- (A fresh install using db/schema.sql already includes these — skip this
-- file in that case.)

ALTER TABLE marketers
  ADD COLUMN role ENUM('field_marketer', 'telemarketer') NOT NULL DEFAULT 'field_marketer' AFTER pin;

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
