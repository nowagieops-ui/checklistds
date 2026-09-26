-- Telemarketer call review: she uploads her recorded calls at the end of
-- the day (either business), AI transcribes and grades each one so
-- coaching is based on the actual call, not a self-report. Purely
-- additive -- no existing table touched.
--
--   mysql -u USER -p DBNAME < db/migrations/012_call_reviews.sql

CREATE TABLE IF NOT EXISTS call_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NOT NULL,
  company ENUM('dashspid', 'nowagieops') NOT NULL DEFAULT 'dashspid',
  original_filename VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100),
  status ENUM('pending', 'processing', 'done', 'error') NOT NULL DEFAULT 'pending',
  transcript LONGTEXT,
  grade INT,
  did_well TEXT,
  to_improve TEXT,
  summary TEXT,
  error_message VARCHAR(500),
  uploaded_at DATETIME NOT NULL,
  processed_at DATETIME,
  FOREIGN KEY (staff_id) REFERENCES marketers(id),
  INDEX idx_call_reviews_status (status)
);
