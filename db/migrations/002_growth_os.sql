-- Growth Operating System: Core Priority Lists, funnel tracking, telemarketer
-- role, reason codes, experiments. Run once against the same Hostinger MySQL
-- database as db/schema.sql (via phpMyAdmin's Import tab, or
-- `mysql -u USER -p DBNAME < db/migrations/002_growth_os.sql` over SSH).
--
-- Purely additive — no existing table is renamed or dropped, and every
-- existing column/row keeps working exactly as before. Requires MySQL 8.0.29+
-- for "ADD COLUMN IF NOT EXISTS" (matches Hostinger's default MySQL 8 offering).

-- ── STAFF ROLES ──────────────────────────────────────────────────────────────
-- Field marketer is the default so every existing marketer row keeps its
-- current behavior untouched. 'manager' is not used for login gating (the
-- shared management PIN still handles that) — it's here so a staff record
-- created for a manager can still be attributed on funnel/order reports.
ALTER TABLE marketers
  ADD COLUMN IF NOT EXISTS role ENUM('field_marketer', 'telemarketer', 'manager') NOT NULL DEFAULT 'field_marketer';

-- ── PROSPECT FUNNEL + ATTRIBUTION ────────────────────────────────────────────
-- staff_ops_code is a one-time attribution/join token, not a durable ID — see
-- platform_business_id below for the canonical reference. See the "Funnel
-- Definitions (Locked)" section of the growth-OS implementation plan for
-- exactly what stamps each timestamp.
--
-- funnel_stage is a GENERATED column, not a value anything writes to
-- directly — it's always derived fresh from the timestamp columns below, the
-- same "computed, not stored state" principle used for the P1-P6 priority
-- lists. That means a partially-failed sync can never leave a prospect
-- stuck showing a stage its timestamps don't actually support.
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS staff_ops_code VARCHAR(10) NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS platform_business_id VARCHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS channel ENUM('field_marketer', 'telemarketer', 'pioneer', 'referral', 'ads', 'other') NOT NULL DEFAULT 'field_marketer',
  ADD COLUMN IF NOT EXISTS is_accepting_orders TINYINT(1) NULL,
  ADD COLUMN IF NOT EXISTS registered_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS activated_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS link_shared_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS first_activity_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS first_order_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS completed_order_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS repeat_business_order_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS first_repeat_customer_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS repeat_customer_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS funnel_stage VARCHAR(20) GENERATED ALWAYS AS (
    CASE
      WHEN completed_order_at IS NOT NULL THEN 'completed_order'
      WHEN first_order_at IS NOT NULL THEN 'first_order'
      WHEN first_activity_at IS NOT NULL THEN 'customer_activity'
      WHEN link_shared_at IS NOT NULL THEN 'link_shared'
      WHEN activated_at IS NOT NULL THEN 'activated'
      WHEN registered_at IS NOT NULL THEN 'registered'
      ELSE 'new'
    END
  ) STORED,
  ADD INDEX IF NOT EXISTS idx_riders_platform_business_id (platform_business_id),
  ADD INDEX IF NOT EXISTS idx_riders_funnel_stage (funnel_stage);

-- ── FOLLOW-UPS / CALL OUTCOMES ───────────────────────────────────────────────
-- One row per staff interaction with a prospect after initial onboarding.
-- Backs both the field marketer's follow-up log and the telemarketer's
-- call-outcome screen. link_shared_confirmed is the only thing that ever
-- stamps riders.link_shared_at — never inferred from a storefront visit.
CREATE TABLE IF NOT EXISTS followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rider_id INT NOT NULL,
  staff_id INT NOT NULL,
  type ENUM('call', 'visit') NOT NULL,
  stage_before VARCHAR(30) NOT NULL,
  stage_after VARCHAR(30) NOT NULL,
  reason_code VARCHAR(50) NULL,
  desired_action VARCHAR(255) NULL,
  action_completed TINYINT(1) NOT NULL DEFAULT 0,
  link_shared_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT,
  next_followup_date DATE NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (rider_id) REFERENCES riders(id),
  FOREIGN KEY (staff_id) REFERENCES marketers(id)
);

-- ── REASON / OBJECTION CODES ─────────────────────────────────────────────────
-- Standardized so reasons can be counted; free-text notes on followups.notes
-- stay alongside these, not replaced by them.
CREATE TABLE IF NOT EXISTS reason_codes (
  code VARCHAR(50) PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1
);

INSERT IGNORE INTO reason_codes (code, label) VALUES
  ('orders_source', 'Confusion about where orders come from'),
  ('pricing_payment', 'Pricing / payment concern'),
  ('trust_legitimacy', 'Trust / head-office legitimacy'),
  ('nipost_licensing', 'NIPOST / licensing concern'),
  ('whatsapp_technical', 'WhatsApp / technical issue'),
  ('product_misunderstanding', 'Product misunderstanding'),
  ('existing_platform', 'Already using an existing platform'),
  ('insufficient_customers', 'Insufficient customers'),
  ('value_concern', 'Value concern'),
  ('other', 'Other');

-- ── EXPERIMENTS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS experiments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  problem TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  change_description TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  target_metric VARCHAR(255) NOT NULL,
  result TEXT NULL,
  decision ENUM('keep', 'modify', 'kill') NULL,
  created_by_staff_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (created_by_staff_id) REFERENCES marketers(id)
);

-- ── TARGETS / BASELINE / CAPACITY ─────────────────────────────────────────────
-- Per staff member, per priority list — evidence-based targets (spec §10),
-- never hardcoded in application code.
CREATE TABLE IF NOT EXISTS priority_targets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NOT NULL,
  priority_list ENUM('P1', 'P2', 'P3', 'P4', 'P5', 'P6') NOT NULL,
  target INT NOT NULL DEFAULT 0,
  baseline INT NOT NULL DEFAULT 0,
  capacity INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uniq_staff_priority (staff_id, priority_list),
  FOREIGN KEY (staff_id) REFERENCES marketers(id)
);
