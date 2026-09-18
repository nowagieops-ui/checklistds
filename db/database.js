const mysql = require('mysql2/promise');
const crypto = require('crypto');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  // DATE/DATETIME columns come back as plain strings instead of JS Date
  // objects. We always write Lagos wall-clock values into these columns
  // ourselves (see nowLagos() in server.js) rather than relying on SQL
  // NOW(), which runs in whatever timezone the DB server happens to be
  // configured for — a mismatch there was making some marketers' same-day
  // records silently fail date-range lookups. Returning plain strings
  // avoids mysql2 re-interpreting those values through a third, unrelated
  // timezone (the Node process's own) when converting to a JS Date object.
  dateStrings: ['DATE', 'DATETIME']
});

function normalizeRider(r) {
  return { ...r, completed: !!r.completed, device_flagged: !!r.device_flagged };
}

const db = {
  // Generic escape hatch for callers with genuinely dynamic SQL (e.g.
  // services/priorityLists.js, whose stage list/filters vary per list) —
  // everything else in this module stays a named, purpose-specific method.
  async query(sql, params) {
    const [rows] = await pool.execute(sql, params);
    return rows.map(r => ('completed' in r || 'device_flagged' in r) ? normalizeRider(r) : r);
  },

  async getMarketers() {
    const [rows] = await pool.execute('SELECT * FROM marketers WHERE active = 1');
    return rows;
  },

  async getMarketer(id, pin) {
    const [rows] = await pool.execute(
      'SELECT * FROM marketers WHERE id = ? AND pin = ? AND active = 1',
      [parseInt(id), pin]
    );
    return rows[0];
  },

  async getMarketerById(id) {
    const [rows] = await pool.execute('SELECT * FROM marketers WHERE id = ?', [parseInt(id)]);
    return rows[0];
  },

  async addMarketer({ name, pin, role }) {
    const [result] = await pool.execute(
      'INSERT INTO marketers (name, pin, active, role) VALUES (?, ?, 1, ?)',
      [name, pin, role || 'field_marketer']
    );
    const [rows] = await pool.execute('SELECT * FROM marketers WHERE id = ?', [result.insertId]);
    return rows[0];
  },

  async getSubmissionsToday(date) {
    const [rows] = await pool.execute('SELECT * FROM submissions WHERE date = ?', [date]);
    return rows;
  },

  async getSubmissionByMarketerToday(marketerId, date) {
    const [rows] = await pool.execute(
      'SELECT * FROM submissions WHERE marketer_id = ? AND date = ? LIMIT 1',
      [parseInt(marketerId), date]
    );
    return rows[0];
  },

  // data.submitted_at is a Lagos wall-clock 'YYYY-MM-DD HH:MM:SS' string
  // (see nowLagos() in server.js) — not SQL NOW().
  async addSubmission(data) {
    const [result] = await pool.execute(
      `INSERT INTO submissions (marketer_id, marketer_name, date, zone, targets, checklist_items, notes, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.marketer_id, data.marketer_name, data.date,
        data.zone, data.targets, JSON.stringify(data.checklist_items || []), data.notes, data.submitted_at
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM submissions WHERE id = ?', [result.insertId]);
    return rows[0];
  },

  async getSubmissionsInRange(fromDate, toDate) {
    const [rows] = await pool.execute(
      'SELECT * FROM submissions WHERE date BETWEEN ? AND ? ORDER BY submitted_at DESC',
      [fromDate, toDate]
    );
    return rows;
  },

  // Returns { id, name } of the marketer this device cookie is already tied
  // to, or null if it's never been seen before.
  async getDeviceOwner(deviceId) {
    const [rows] = await pool.execute(
      `SELECT m.id, m.name FROM marketer_devices md
       JOIN marketers m ON m.id = md.marketer_id
       WHERE md.device_id = ? LIMIT 1`,
      [deviceId]
    );
    return rows[0] || null;
  },

  async registerDevice(marketerId, deviceId) {
    await pool.execute(
      'INSERT IGNORE INTO marketer_devices (marketer_id, device_id) VALUES (?, ?)',
      [parseInt(marketerId), deviceId]
    );
  },

  // entry.timestamp is a Lagos wall-clock 'YYYY-MM-DD HH:MM:SS' string (see
  // nowLagos() in server.js) — not SQL NOW().
  async addAttendance(entry) {
    const [result] = await pool.execute(
      `INSERT INTO attendance
        (marketer_id, marketer_name, type, lat, lng, accuracy, ip, device_id, user_agent, flagged, flags, riders_onboarded, summary, address, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.marketer_id,
        entry.marketer_name,
        entry.type,
        entry.lat,
        entry.lng,
        entry.accuracy != null ? entry.accuracy : null,
        entry.ip,
        entry.device_id,
        entry.user_agent,
        entry.flagged ? 1 : 0,
        JSON.stringify(entry.flags || []),
        entry.riders_onboarded != null ? entry.riders_onboarded : null,
        entry.summary != null ? entry.summary : null,
        entry.address != null ? entry.address : null,
        entry.timestamp
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM attendance WHERE id = ?', [result.insertId]);
    return { ...rows[0], flagged: !!rows[0].flagged };
  },

  async getAttendanceToday(date) {
    const [rows] = await pool.execute('SELECT * FROM attendance WHERE DATE(timestamp) = ?', [date]);
    return rows.map(r => ({ ...r, flagged: !!r.flagged }));
  },

  async getAttendanceInRange(fromDate, toDate) {
    const [rows] = await pool.execute(
      'SELECT * FROM attendance WHERE DATE(timestamp) BETWEEN ? AND ? ORDER BY timestamp DESC',
      [fromDate, toDate]
    );
    return rows.map(r => ({ ...r, flagged: !!r.flagged }));
  },

  async getAttendanceForMarketerInRange(marketerId, fromDate, toDate) {
    const [rows] = await pool.execute(
      'SELECT * FROM attendance WHERE marketer_id = ? AND DATE(timestamp) BETWEEN ? AND ? ORDER BY timestamp ASC',
      [parseInt(marketerId), fromDate, toDate]
    );
    return rows.map(r => ({ ...r, flagged: !!r.flagged }));
  },

  // Returns 'YYYY-MM-DD' of this marketer's very first attendance record, or
  // null if they've never checked in — used so a brand-new hire's calendar
  // doesn't show fabricated "missed" days from before they even started.
  async getEarliestAttendanceDate(marketerId) {
    const [rows] = await pool.execute(
      'SELECT MIN(DATE(timestamp)) AS earliest FROM attendance WHERE marketer_id = ?',
      [parseInt(marketerId)]
    );
    return rows[0] ? rows[0].earliest : null;
  },

  // createdAt is a Lagos wall-clock 'YYYY-MM-DD HH:MM:SS' string (see
  // nowLagos() in server.js) — not SQL NOW().
  async addRider({ name, email, phone, added_by_marketer_id, added_by_marketer_name, device_id, user_agent, device_flagged, device_flag_reason, channel }, createdAt) {
    const [result] = await pool.execute(
      `INSERT INTO riders
        (name, email, phone, added_by_marketer_id, added_by_marketer_name, created_at, checklist_items, completed, device_id, user_agent, device_flagged, device_flag_reason, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        name, email, phone, added_by_marketer_id, added_by_marketer_name, createdAt, JSON.stringify([]),
        device_id || null,
        user_agent || null,
        device_flagged ? 1 : 0,
        device_flag_reason || null,
        channel || 'field_marketer'
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM riders WHERE id = ?', [result.insertId]);
    return normalizeRider(rows[0]);
  },

  async getRider(id) {
    const [rows] = await pool.execute('SELECT * FROM riders WHERE id = ?', [parseInt(id)]);
    return rows[0] ? normalizeRider(rows[0]) : undefined;
  },

  async completeRiderChecklist(riderId, checklistItems, notes, completedAt) {
    // Generated once, here, rather than at rider creation — this is the
    // attribution/join code staff relay to the business, and it shouldn't be
    // handed out before onboarding is actually confirmed complete.
    const staffOpsCode = await this._generateUniqueStaffOpsCode();
    await pool.execute(
      'UPDATE riders SET checklist_items = ?, notes = ?, completed = 1, completed_at = ?, staff_ops_code = ? WHERE id = ?',
      [JSON.stringify(checklistItems || []), notes || null, completedAt, staffOpsCode, parseInt(riderId)]
    );
    const [rows] = await pool.execute('SELECT * FROM riders WHERE id = ?', [parseInt(riderId)]);
    return rows[0] ? normalizeRider(rows[0]) : null;
  },

  // 7 chars from an unambiguous charset (no 0/O/1/I/L), mirroring the
  // platform's own referral-code style — checked for collisions against
  // live rows since this becomes a real join key against businesses.marketer_code.
  async _generateUniqueStaffOpsCode() {
    const chars = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
    for (let attempt = 0; attempt < 10; attempt++) {
      let code = '';
      for (let i = 0; i < 7; i++) code += chars[crypto.randomInt(chars.length)];
      const [rows] = await pool.execute('SELECT id FROM riders WHERE staff_ops_code = ? LIMIT 1', [code]);
      if (rows.length === 0) return code;
    }
    throw new Error('Could not generate a unique staff_ops_code after 10 attempts');
  },

  // ── GROWTH OS: FUNNEL / ATTRIBUTION SYNC ────────────────────────────────────

  // Prospects that have a join code but haven't been matched to a platform
  // business yet — what platformSync.matchProspects() works through.
  async getUnmatchedProspectsWithCode() {
    const [rows] = await pool.execute(
      'SELECT id, staff_ops_code FROM riders WHERE staff_ops_code IS NOT NULL AND platform_business_id IS NULL'
    );
    return rows;
  },

  // Sets the canonical platform reference once a code match is found.
  // Never overwrites an existing platform_business_id — a code is
  // single-use by construction (unmatched-only query above), but this
  // guards against a re-run linking a prospect a second time.
  async linkRiderToPlatformBusiness(riderId, platformBusinessId, registeredAt) {
    await pool.execute(
      'UPDATE riders SET platform_business_id = ?, registered_at = COALESCE(registered_at, ?) WHERE id = ? AND platform_business_id IS NULL',
      [platformBusinessId, registeredAt, parseInt(riderId)]
    );
  },

  // Every platform business.id already linked to some prospect — used to
  // skip re-evaluating businesses the sync has already matched (whether via
  // exact code or the name-based fallback below).
  async getLinkedPlatformBusinessIds() {
    const [rows] = await pool.execute('SELECT platform_business_id FROM riders WHERE platform_business_id IS NOT NULL');
    return rows.map(r => r.platform_business_id);
  },

  // Best-effort pairing for the name-based fallback match: if this staff
  // member already has a prospect they onboarded but haven't linked yet,
  // prefer attaching the platform signup to that real record (keeps any
  // onboarding-checklist data) over creating a fresh one.
  async getOldestUnmatchedProspectForMarketer(marketerId) {
    const [rows] = await pool.execute(
      'SELECT id FROM riders WHERE added_by_marketer_id = ? AND platform_business_id IS NULL ORDER BY created_at ASC LIMIT 1',
      [parseInt(marketerId)]
    );
    return rows[0] || null;
  },

  // Creates the funnel-tracking record directly from a platform signup that
  // was never onboarded through the app's checklist flow — the reality for
  // most signups right now, since riders just tell the platform a staff
  // member's name rather than relaying a generated code.
  async createLinkedProspectFromPlatform({ name, email, phone, marketerId, marketerName, channel, platformBusinessId, registeredAt }) {
    const [result] = await pool.execute(
      `INSERT INTO riders
        (name, email, phone, added_by_marketer_id, added_by_marketer_name, created_at, checklist_items, completed, channel, platform_business_id, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [name || 'Unnamed business', email || '', phone || '', marketerId, marketerName, registeredAt, JSON.stringify([]), channel, platformBusinessId, registeredAt]
    );
    return result.insertId;
  },

  // Prospects already linked to a platform business — what
  // platformSync.syncOutcomes() re-checks against live Supabase data on
  // every run. Deliberately not filtered by funnel_stage: repeat-order and
  // repeat-customer fields can still change long after "completed_order".
  async getLinkedProspects() {
    const [rows] = await pool.execute(
      `SELECT id, platform_business_id, is_accepting_orders, activated_at, link_shared_at,
              first_activity_at, first_order_at, completed_order_at, repeat_business_order_at,
              first_repeat_customer_at, repeat_customer_count
       FROM riders WHERE platform_business_id IS NOT NULL`
    );
    return rows;
  },

  // Applies whichever funnel timestamps/fields are newly known. Every
  // timestamp field uses COALESCE so a sync run can never regress or
  // overwrite a stage that already fired — only fill in what was NULL.
  // Live facts, not one-time milestones — always overwritten with the
  // latest known value, unlike the COALESCE'd funnel timestamps.
  async updateRiderStorefrontInfo(riderId, { storefrontUrl, uniqueVisitorCount, linkShareCount }) {
    await pool.execute(
      'UPDATE riders SET storefront_url = ?, unique_visitor_count = ?, link_share_count = ? WHERE id = ?',
      [storefrontUrl || null, uniqueVisitorCount || 0, linkShareCount || 0, parseInt(riderId)]
    );
  },

  // Always overwritten with the latest known fact, unlike the funnel
  // timestamps — a business could add payout details or set pricing later,
  // and the checklist claim should be judged against current reality.
  async updateRiderChecklistVerification(riderId, { pricingVerified, payoutVerified }) {
    await pool.execute(
      'UPDATE riders SET checklist_pricing_verified = ?, checklist_payout_verified = ? WHERE id = ?',
      [pricingVerified ? 1 : 0, payoutVerified ? 1 : 0, parseInt(riderId)]
    );
  },

  // The only thing that ever sets link_shared_at — a staff member confirming
  // it in a follow-up, never inferred from a storefront visit. COALESCE'd so
  // it can only be set once, same guarantee as updateRiderFunnelOutcomes.
  async confirmLinkShared(riderId, when) {
    await pool.execute(
      'UPDATE riders SET link_shared_at = COALESCE(link_shared_at, ?) WHERE id = ?',
      [when, parseInt(riderId)]
    );
  },

  async getReasonCodes() {
    const [rows] = await pool.execute('SELECT code, label FROM reason_codes WHERE active = 1 ORDER BY label ASC');
    return rows;
  },

  async getFollowupsForRider(riderId) {
    const [rows] = await pool.execute(
      `SELECT f.*, m.name AS staff_name FROM followups f
       JOIN marketers m ON m.id = f.staff_id
       WHERE f.rider_id = ? ORDER BY f.created_at DESC`,
      [parseInt(riderId)]
    );
    return rows;
  },

  // Every rider_id this staff member has already logged ANY followup
  // against today — used to grey out the quick-call button (it should only
  // ever add one contact per prospect per day) and to know which rows don't
  // need it shown at all.
  async getContactedTodayRiderIds(staffId, todayDate) {
    const [rows] = await pool.execute(
      'SELECT DISTINCT rider_id FROM followups WHERE staff_id = ? AND DATE(created_at) = ?',
      [staffId, todayDate]
    );
    return rows.map(r => r.rider_id);
  },

  async hasContactedToday(staffId, riderId, todayDate) {
    const [rows] = await pool.execute(
      'SELECT id FROM followups WHERE staff_id = ? AND rider_id = ? AND DATE(created_at) = ? LIMIT 1',
      [staffId, parseInt(riderId), todayDate]
    );
    return rows.length > 0;
  },

  async addFollowup(data) {
    await pool.execute(
      `INSERT INTO followups
        (rider_id, staff_id, type, stage_before, stage_after, reason_code, desired_action, action_completed, link_shared_confirmed, notes, next_followup_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.rider_id, data.staff_id, data.type, data.stage_before, data.stage_after,
        data.reason_code || null, data.desired_action || null, data.action_completed ? 1 : 0,
        data.link_shared_confirmed ? 1 : 0, data.notes || null, data.next_followup_date || null, data.created_at
      ]
    );
  },

  async getExperiments() {
    const [rows] = await pool.execute('SELECT * FROM experiments ORDER BY start_date DESC, id DESC');
    return rows;
  },

  async addExperiment(data) {
    await pool.execute(
      `INSERT INTO experiments (problem, hypothesis, change_description, start_date, target_metric, created_by_staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.problem, data.hypothesis, data.change_description, data.start_date, data.target_metric, data.created_by_staff_id || null, data.created_at]
    );
  },

  async updateExperimentResult(id, { result, decision, end_date }) {
    await pool.execute(
      'UPDATE experiments SET result = ?, decision = ?, end_date = COALESCE(?, end_date) WHERE id = ?',
      [result || null, decision || null, end_date || null, parseInt(id)]
    );
  },

  async updateRiderFunnelOutcomes(riderId, fields) {
    const settable = ['is_accepting_orders', 'activated_at', 'first_activity_at', 'first_order_at',
      'completed_order_at', 'repeat_business_order_at', 'first_repeat_customer_at', 'repeat_customer_count'];
    const sets = [];
    const values = [];
    for (const key of settable) {
      if (!(key in fields)) continue;
      if (key === 'is_accepting_orders' || key === 'repeat_customer_count') {
        sets.push(`${key} = ?`);
        values.push(fields[key]);
      } else {
        sets.push(`${key} = COALESCE(${key}, ?)`);
        values.push(fields[key]);
      }
    }
    if (sets.length === 0) return;
    values.push(parseInt(riderId));
    await pool.execute(`UPDATE riders SET ${sets.join(', ')} WHERE id = ?`, values);
  },

  async getRidersAddedByOnDate(marketerId, date) {
    const [rows] = await pool.execute(
      'SELECT * FROM riders WHERE added_by_marketer_id = ? AND DATE(created_at) = ?',
      [parseInt(marketerId), date]
    );
    return rows.map(normalizeRider);
  },

  async getRidersInRange(fromDate, toDate) {
    const [rows] = await pool.execute(
      'SELECT * FROM riders WHERE DATE(created_at) BETWEEN ? AND ? ORDER BY created_at DESC',
      [fromDate, toDate]
    );
    return rows.map(normalizeRider);
  },

  async getTrainingProgress(marketerId) {
    const [rows] = await pool.execute(
      'SELECT * FROM training_progress WHERE marketer_id = ?',
      [parseInt(marketerId)]
    );
    return rows[0] || null;
  },

  // now is a Lagos wall-clock 'YYYY-MM-DD HH:MM:SS' string (see nowLagos()
  // in server.js) — not SQL NOW(). Upserts so repeated quiz-pass saves during
  // one training run don't create duplicate rows (marketer_id is UNIQUE).
  async upsertTrainingProgress(marketerId, completedModules, roleplayLog, now) {
    await pool.execute(
      `INSERT INTO training_progress (marketer_id, completed_modules, roleplay_log, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE completed_modules = VALUES(completed_modules), roleplay_log = VALUES(roleplay_log), updated_at = VALUES(updated_at)`,
      [parseInt(marketerId), JSON.stringify(completedModules || {}), JSON.stringify(roleplayLog || []), now, now]
    );
    const [rows] = await pool.execute('SELECT * FROM training_progress WHERE marketer_id = ?', [parseInt(marketerId)]);
    return rows[0];
  },

  async completeTraining(marketerId, completedAt) {
    await pool.execute('UPDATE training_progress SET completed_at = ? WHERE marketer_id = ?', [completedAt, parseInt(marketerId)]);
    const [rows] = await pool.execute('SELECT * FROM training_progress WHERE marketer_id = ?', [parseInt(marketerId)]);
    return rows[0] || null;
  },

  // ── WEEKLY TRAINING PROGRAM (weeks 2-12, ongoing alongside normal work) ──

  async getWeekProgress(marketerId, weekNumber) {
    const [rows] = await pool.execute(
      'SELECT * FROM training_weeks_progress WHERE marketer_id = ? AND week_number = ?',
      [parseInt(marketerId), weekNumber]
    );
    return rows[0] || null;
  },

  // All weeks (2-12) this marketer has any record for — used to find the
  // highest completed week when computing which week unlocks next.
  async getAllWeekProgress(marketerId) {
    const [rows] = await pool.execute(
      'SELECT * FROM training_weeks_progress WHERE marketer_id = ? ORDER BY week_number ASC',
      [parseInt(marketerId)]
    );
    return rows;
  },

  // now is a Lagos wall-clock 'YYYY-MM-DD HH:MM:SS' string — not SQL NOW().
  async upsertWeekProgress(marketerId, weekNumber, completedModules, roleplayLog, now) {
    await pool.execute(
      `INSERT INTO training_weeks_progress (marketer_id, week_number, completed_modules, roleplay_log, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE completed_modules = VALUES(completed_modules), roleplay_log = VALUES(roleplay_log), updated_at = VALUES(updated_at)`,
      [parseInt(marketerId), weekNumber, JSON.stringify(completedModules || {}), JSON.stringify(roleplayLog || []), now, now]
    );
    const [rows] = await pool.execute(
      'SELECT * FROM training_weeks_progress WHERE marketer_id = ? AND week_number = ?',
      [parseInt(marketerId), weekNumber]
    );
    return rows[0];
  },

  async completeWeekProgress(marketerId, weekNumber, completedAt) {
    await pool.execute(
      'UPDATE training_weeks_progress SET completed_at = ? WHERE marketer_id = ? AND week_number = ?',
      [completedAt, parseInt(marketerId), weekNumber]
    );
    const [rows] = await pool.execute(
      'SELECT * FROM training_weeks_progress WHERE marketer_id = ? AND week_number = ?',
      [parseInt(marketerId), weekNumber]
    );
    return rows[0] || null;
  }
};

module.exports = db;
