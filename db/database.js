const mysql = require('mysql2/promise');

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
  return { ...r, completed: !!r.completed };
}

const db = {
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
        (marketer_id, marketer_name, type, lat, lng, accuracy, ip, device_id, user_agent, flagged, flags, riders_onboarded, summary, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  async addRider({ name, email, phone, added_by_marketer_id, added_by_marketer_name }, createdAt) {
    const [result] = await pool.execute(
      `INSERT INTO riders (name, email, phone, added_by_marketer_id, added_by_marketer_name, created_at, checklist_items, completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [name, email, phone, added_by_marketer_id, added_by_marketer_name, createdAt, JSON.stringify([])]
    );
    const [rows] = await pool.execute('SELECT * FROM riders WHERE id = ?', [result.insertId]);
    return normalizeRider(rows[0]);
  },

  async getRider(id) {
    const [rows] = await pool.execute('SELECT * FROM riders WHERE id = ?', [parseInt(id)]);
    return rows[0] ? normalizeRider(rows[0]) : undefined;
  },

  async completeRiderChecklist(riderId, checklistItems, notes, completedAt) {
    await pool.execute(
      'UPDATE riders SET checklist_items = ?, notes = ?, completed = 1, completed_at = ? WHERE id = ?',
      [JSON.stringify(checklistItems || []), notes || null, completedAt, parseInt(riderId)]
    );
    const [rows] = await pool.execute('SELECT * FROM riders WHERE id = ?', [parseInt(riderId)]);
    return rows[0] ? normalizeRider(rows[0]) : null;
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
  }
};

module.exports = db;
