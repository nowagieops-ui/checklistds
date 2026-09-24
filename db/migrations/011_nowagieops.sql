-- Adds NowagieOps as a second business a telemarketer can be assigned to,
-- alongside DashSpid. Purely additive: two new flags on marketers, plus a
-- full set of NowagieOps-only tables mirroring the DashSpid ones exactly
-- (separate leads/followups/training/sheet-sync tables) rather than
-- retrofitting composite keys onto the existing DashSpid training tables,
-- which would mean guessing at an existing UNIQUE index's auto-generated
-- name on a live production table. No existing table, column, or
-- constraint is touched or renamed.
--
--   mysql -u USER -p DBNAME < db/migrations/011_nowagieops.sql

-- ── COMPANY ASSIGNMENT ───────────────────────────────────────────────────────
-- Which business(es) a marketer works. Defaults keep every existing row
-- exactly as it is today (DashSpid only) -- nothing changes until someone
-- ticks the NowagieOps box for a marketer in Add/Edit Staff.
ALTER TABLE marketers
  ADD COLUMN IF NOT EXISTS works_dashspid TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS works_nowagieops TINYINT(1) NOT NULL DEFAULT 0;

-- ── NOWAGIEOPS LEADS ──────────────────────────────────────────────────────────
-- A UK business being cold-called to book a free strategy call. Far flatter
-- than riders/funnel_stage on purpose -- there is no platform to sync
-- against here, and the telemarketer's job stops the moment a call is
-- booked. cal_booking_id is only ever set by the Cal.com sync, never typed
-- by hand, so "booked" is always a verified fact, not a self-report.
CREATE TABLE IF NOT EXISTS nowagie_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(255) NULL,
  business_name VARCHAR(255) NULL,
  notes VARCHAR(255) NULL,
  added_by_marketer_id INT NOT NULL,
  added_by_marketer_name VARCHAR(255) NOT NULL,
  channel ENUM('telemarketer', 'referral', 'other') NOT NULL DEFAULT 'telemarketer',
  contacted_at DATETIME NULL,
  not_interested_at DATETIME NULL,
  cal_booking_id VARCHAR(100) NULL,
  cal_booking_time DATETIME NULL,
  cal_booking_status VARCHAR(30) NULL,
  stage VARCHAR(20) GENERATED ALWAYS AS (
    CASE
      WHEN cal_booking_id IS NOT NULL THEN 'call_booked'
      WHEN not_interested_at IS NOT NULL THEN 'not_interested'
      WHEN contacted_at IS NOT NULL THEN 'contacted'
      ELSE 'new'
    END
  ) STORED,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (added_by_marketer_id) REFERENCES marketers(id),
  INDEX idx_nowagie_leads_stage (stage),
  INDEX idx_nowagie_leads_phone (phone)
);

-- ── CALL LOG ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nowagie_followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  staff_id INT NOT NULL,
  stage_before VARCHAR(20) NOT NULL,
  stage_after VARCHAR(20) NOT NULL,
  reason_code VARCHAR(50) NULL,
  outcome VARCHAR(30) NULL,
  notes TEXT,
  next_followup_date DATE NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'app',
  created_at DATETIME NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES nowagie_leads(id),
  FOREIGN KEY (staff_id) REFERENCES marketers(id)
);

CREATE TABLE IF NOT EXISTS nowagie_reason_codes (
  code VARCHAR(50) PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
);

INSERT IGNORE INTO nowagie_reason_codes (code, label) VALUES
  ('gatekeeper', 'Blocked by gatekeeper'),
  ('no_budget', 'No budget right now'),
  ('has_agency', 'Already has someone / an agency'),
  ('bad_experience', 'Burned by a past agency'),
  ('not_relevant', 'Not relevant / not interested'),
  ('send_info', 'Asked for info instead of a call'),
  ('no_answer', 'No answer'),
  ('wrong_number', 'Wrong number'),
  ('other', 'Other');

-- ── GOOGLE SHEET SYNC (NowagieOps) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nowagie_sheet_sync_rows (
  lead_id INT PRIMARY KEY,
  lead_hash VARCHAR(64) NOT NULL,
  call_hash VARCHAR(64) NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES nowagie_leads(id)
);

-- ── TRAINING ACADEMY (NowagieOps) ────────────────────────────────────────────
-- Mirrors training_progress / training_weeks_progress exactly -- a one-time
-- Week 1 hard gate plus an 8-week ongoing program (Friday unlocks instead
-- of Monday), entirely independent of the DashSpid academy so a marketer
-- who works both businesses completes both tracks on their own schedules.
CREATE TABLE IF NOT EXISTS nowagie_training_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  marketer_id INT NOT NULL UNIQUE,
  completed_modules JSON,
  roleplay_log JSON,
  started_at DATETIME NOT NULL,
  completed_at DATETIME,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (marketer_id) REFERENCES marketers(id)
);

CREATE TABLE IF NOT EXISTS nowagie_training_weeks_progress (
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
