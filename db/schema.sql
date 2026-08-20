-- Run this once against your Hostinger MySQL database (via hPanel > phpMyAdmin,
-- or `mysql -u USER -p DBNAME < db/schema.sql`) before starting the app.

CREATE TABLE IF NOT EXISTS marketers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  pin VARCHAR(20) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS marketer_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketer_id INT NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  UNIQUE KEY uniq_marketer_device (marketer_id, device_id),
  FOREIGN KEY (marketer_id) REFERENCES marketers(id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketer_id INT NOT NULL,
  marketer_name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  zone VARCHAR(255) DEFAULT '',
  targets VARCHAR(255) DEFAULT '',
  checklist_items JSON,
  notes TEXT,
  submitted_at DATETIME NOT NULL,
  FOREIGN KEY (marketer_id) REFERENCES marketers(id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketer_id INT NOT NULL,
  marketer_name VARCHAR(255) NOT NULL,
  type ENUM('login', 'logout') NOT NULL,
  lat DOUBLE,
  lng DOUBLE,
  accuracy DOUBLE,
  ip VARCHAR(64),
  device_id VARCHAR(64),
  user_agent TEXT,
  flagged TINYINT(1) NOT NULL DEFAULT 0,
  flags JSON,
  riders_onboarded INT,
  summary TEXT,
  address VARCHAR(500),
  timestamp DATETIME NOT NULL,
  FOREIGN KEY (marketer_id) REFERENCES marketers(id)
);

CREATE TABLE IF NOT EXISTS riders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  added_by_marketer_id INT NOT NULL,
  added_by_marketer_name VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  checklist_items JSON,
  notes TEXT,
  completed TINYINT(1) NOT NULL DEFAULT 0,
  completed_at DATETIME,
  FOREIGN KEY (added_by_marketer_id) REFERENCES marketers(id)
);

-- Seed the two existing marketers so logins keep working after migration.
-- Change these PINs immediately if they haven't been changed already.
INSERT INTO marketers (name, pin, active) VALUES
  ('Etuka Joseph', '1043', 1),
  ('Chiamaka Nwoke', '2128', 1);
