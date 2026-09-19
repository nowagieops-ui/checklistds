// Two-way sync between one Google Sheet tab and the app's lead data, so leads
// can be bulk-pasted and calls logged in the sheet as easily as in the app.
//
// Design rule that keeps this conflict-free: no cell is ever written from
// both sides.
//   Columns A-J are INPUT (owned by the sheet): lead details + a call-log
//   block. Changes there flow into the app — new rows become leads, edited
//   details update the lead, and each change to the call-log block becomes a
//   logged contact (followups row), so it shows up in the staff member's own
//   pages and the manager dashboard exactly like a call logged in the app.
//   Columns K-O are OUTPUT (owned by the app): stage, calls logged, last
//   called, last feedback, sync status. They refresh from the database every
//   run, so a call logged in the app appears in the sheet within one cycle.
//
// A lead created in the app also gets appended to the sheet automatically.
//
// What she changed since the last run is detected by hashing each row's input
// values and comparing to the hashes stored in sheet_sync_rows.
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db/database');
const { nowLagos } = require('../utils/time');

const HEADERS = [
  'App ID', 'Name', 'Phone', 'Area / Notes', 'Assigned To',
  'Call Outcome', 'Reason', 'Feedback', 'Next Follow-up', 'Link Shared?',
  'Stage', 'Calls Logged', 'Last Called', 'Last Feedback', 'Sync Status'
];
const INPUT_COLS = 10; // A-J
const TOTAL_COLS = HEADERS.length; // A-O

const STAGE_LABELS = {
  new: 'New', registered: 'Registered', activated: 'Activated', link_shared: 'Link shared',
  customer_activity: 'Customer activity', first_order: 'First order', completed_order: 'Completed order'
};

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!spreadsheetId || !email || !rawKey) return null;
  return {
    spreadsheetId,
    email,
    // The key arrives with literal "\n" sequences (and sometimes wrapping
    // quotes) when pasted into an env var — restore real PEM formatting.
    privateKey: rawKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
    tab: process.env.GOOGLE_SHEETS_TAB || 'Leads',
    defaultStaffId: process.env.SHEETS_DEFAULT_STAFF_ID ? parseInt(process.env.SHEETS_DEFAULT_STAFF_ID, 10) : null
  };
}

function isConfigured() {
  return !!getConfig();
}

// ── GOOGLE AUTH + SHEETS REST ────────────────────────────────────────────────

let cachedToken = null;

async function getAccessToken(cfg) {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60 * 1000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: cfg.email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(cfg.privateKey).toString('base64url');

  const res = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
  );
  cachedToken = { token: res.data.access_token, expiresAt: Date.now() + res.data.expires_in * 1000 };
  return cachedToken.token;
}

async function sheetsRequest(cfg, method, path, { params, data } = {}) {
  const token = await getAccessToken(cfg);
  try {
    const res = await axios({
      method,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}${path}`,
      params,
      data,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    });
    return res.data;
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.error && err.response.data.error.message;
    throw new Error(detail ? `Google Sheets: ${detail}` : err.message);
  }
}

function tabRange(cfg, a1) {
  return `'${cfg.tab.replace(/'/g, "''")}'!${a1}`;
}

// ── SMALL HELPERS ────────────────────────────────────────────────────────────

function hashOf(values) {
  return crypto.createHash('sha1').update(JSON.stringify(values)).digest('hex');
}

function cellText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function phoneTail(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

// Google Sheets drops a pasted phone's leading zero (08012345678 becomes the
// number 8012345678) — put it back so leads are stored the way the rest of
// the app expects, and convert +234 forms.
function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('234')) return '0' + digits.slice(3);
  if (digits.length === 10) return '0' + digits;
  return digits || String(raw || '').trim();
}

function isValidPhone(raw) {
  return String(raw || '').replace(/\D/g, '').length >= 7;
}

// Accepts 2026-09-25, 25/09/2026, 25-09-2026, "25 Sep 2026" etc. For a slash
// date where both parts could be a month, day-first wins (Nigeria) — set the
// spreadsheet's locale to Nigeria so what she sees matches.
function parseDate(str) {
  const s = cellText(str);
  if (!s) return null;
  let y, mo, d;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) {
    const a = +m[1], b = +m[2];
    y = +m[3]; if (y < 100) y += 2000;
    if (a > 12) { d = a; mo = b; } else if (b > 12) { mo = a; d = b; } else { d = a; mo = b; }
  } else {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    y = dt.getFullYear(); mo = dt.getMonth() + 1; d = dt.getDate();
  }
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isYes(str) {
  return /^(y|yes|true|1|✓|x)$/i.test(cellText(str));
}

function resolveStaff(typed, staffList, defaultStaffId) {
  const t = cellText(typed).toLowerCase();
  if (!t) {
    const fallback = defaultStaffId && staffList.find(s => s.id === defaultStaffId);
    return fallback ? { staff: fallback } : { error: 'Fill in "Assigned To" (or set SHEETS_DEFAULT_STAFF_ID)' };
  }
  const exact = staffList.filter(s => s.name.trim().toLowerCase() === t);
  if (exact.length === 1) return { staff: exact[0] };
  const tokens = t.split(/\s+/);
  const loose = staffList.filter(s => {
    const nameTokens = s.name.toLowerCase().split(/\s+/);
    return tokens.every(tok => nameTokens.includes(tok));
  });
  if (loose.length === 1) return { staff: loose[0] };
  return { error: loose.length > 1 ? `"${typed}" matches more than one staff member` : `No staff member called "${typed}"` };
}

function resolveReason(typed, reasonCodes) {
  const t = cellText(typed).toLowerCase();
  if (!t) return { code: null, extraNote: '' };
  const hit = reasonCodes.find(r => r.code.toLowerCase() === t || r.label.toLowerCase() === t);
  return hit ? { code: hit.code, extraNote: '' } : { code: 'other', extraNote: `Reason: ${cellText(typed)}. ` };
}

// [3, 4, 5, 9] -> [[3, 5], [9, 9]]
function groupContiguous(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const groups = [];
  sorted.forEach(n => {
    const last = groups[groups.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else groups.push([n, n]);
  });
  return groups;
}

function outputCells(rider, summary, status) {
  const s = summary || { calls: 0, lastAt: null, lastNotes: null };
  return [
    STAGE_LABELS[rider.funnel_stage] || rider.funnel_stage || '',
    String(s.calls),
    s.lastAt ? String(s.lastAt).slice(0, 10) : '',
    s.lastNotes ? String(s.lastNotes).trim().slice(0, 200).trim() : '',
    status
  ];
}

// ── SYNC ─────────────────────────────────────────────────────────────────────

let running = false;

async function ensureHeaders(cfg, rows) {
  const first = rows[0] || [];
  const isEmpty = first.every(c => !cellText(c));
  if (isEmpty) {
    await sheetsRequest(cfg, 'put', `/values/${encodeURIComponent(tabRange(cfg, 'A1:O1'))}`, {
      params: { valueInputOption: 'RAW' },
      data: { values: [HEADERS] }
    });
    return;
  }
  const mismatch = HEADERS.slice(0, INPUT_COLS).some((h, i) => cellText(first[i]).toLowerCase() !== h.toLowerCase());
  if (mismatch) {
    throw new Error(`Row 1 of the "${cfg.tab}" tab doesn't match the expected headers (${HEADERS.slice(0, INPUT_COLS).join(', ')}). Fix the header row or use a fresh tab.`);
  }
}

async function logCall(rider, fields, reasonCodes, now) {
  const before = await db.getRider(rider.id);
  if (fields.linkShared) await db.confirmLinkShared(rider.id, now);
  const after = await db.getRider(rider.id);
  const reason = resolveReason(fields.reason, reasonCodes);
  const noteText = (reason.extraNote + fields.feedback).trim();
  await db.addSheetFollowup({
    rider_id: rider.id,
    staff_id: after.added_by_marketer_id,
    stage_before: before.funnel_stage,
    stage_after: after.funnel_stage,
    reason_code: reason.code,
    link_shared_confirmed: fields.linkShared,
    notes: noteText || null,
    next_followup_date: parseDate(fields.nextFollowup),
    created_at: now,
    outcome: fields.outcome ? fields.outcome.slice(0, 30) : null
  });
}

async function runSync() {
  const cfg = getConfig();
  if (!cfg) return { skipped: 'Google Sheet sync is not configured' };
  if (running) return { skipped: 'A sync is already running' };
  running = true;

  try {
    let syncRows;
    try {
      syncRows = await db.getSheetSyncRows();
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') throw new Error('Run db/migrations/009_google_sheet_sync.sql first');
      throw err;
    }

    const read = await sheetsRequest(cfg, 'get', `/values/${encodeURIComponent(tabRange(cfg, 'A1:O'))}`, {
      params: { valueRenderOption: 'FORMATTED_VALUE' }
    });
    const grid = (read.values || []).map(r => Array.from({ length: TOTAL_COLS }, (_, i) => cellText(r[i])));
    await ensureHeaders(cfg, grid);
    const dataRows = grid.slice(1);

    const staffList = await db.getMarketers();
    const reasonCodes = await db.getReasonCodes();
    const ridersBefore = await db.getRidersForSheet();
    const ridersById = {};
    ridersBefore.forEach(r => { ridersById[r.id] = r; });
    const phoneToRider = {};
    (await db.getAllRiderPhones()).forEach(r => {
      const tail = phoneTail(r.phone);
      if (tail && !phoneToRider[tail]) phoneToRider[tail] = r.id;
    });

    const stats = { created: 0, linked: 0, updated: 0, callsLogged: 0, appended: 0, errors: 0 };
    const now = nowLagos();
    const seenIds = new Set();
    const rowInfo = []; // per data row: { riderId, status }

    for (let i = 0; i < dataRows.length; i++) {
      const cells = dataRows[i];
      const [appIdRaw, name, phone, area, assigned, outcome, reason, feedback, nextFollowup, linkSharedRaw] = cells;
      const info = { riderId: null, status: '', newId: false };
      rowInfo.push(info);

      if (cells.slice(0, INPUT_COLS).every(c => !c)) continue; // blank row

      const leadHash = hashOf([name, phone, area, assigned]);
      const callFields = { outcome, reason, feedback, nextFollowup, linkShared: isYes(linkSharedRaw) };
      const callBlockUsed = !!(outcome || reason || feedback || nextFollowup || callFields.linkShared);
      const callHash = hashOf([outcome, reason, feedback, nextFollowup, linkSharedRaw]);

      try {
        let rider;
        let mapping;
        let statusText = 'Synced';

        if (!appIdRaw) {
          // New row: link to an existing lead with the same number, else create.
          if (!isValidPhone(phone)) { info.status = 'Needs a valid phone number'; stats.errors++; continue; }
          const tail = phoneTail(phone);
          const existingId = phoneToRider[tail];
          if (existingId) {
            rider = ridersById[existingId] || await db.getRider(existingId);
            statusText = 'Linked to existing lead';
            stats.linked++;
          } else {
            const resolved = resolveStaff(assigned, staffList, cfg.defaultStaffId);
            if (resolved.error) { info.status = resolved.error; stats.errors++; continue; }
            const phoneStored = formatPhone(phone);
            const created = await db.addRider({
              name: name || `Lead ${phoneStored}`,
              email: '',
              phone: phoneStored,
              added_by_marketer_id: resolved.staff.id,
              added_by_marketer_name: resolved.staff.name,
              channel: 'telemarketer'
            }, now);
            if (area) {
              await db.updateRiderLeadFields(created.id, {
                name: created.name, phone: created.phone, notes: area,
                marketerId: resolved.staff.id, marketerName: resolved.staff.name
              });
            }
            rider = await db.getRider(created.id);
            phoneToRider[tail] = rider.id;
            statusText = `Created · ${resolved.staff.name}`;
            stats.created++;
          }
          info.newId = true;
          mapping = { lead_hash: leadHash, call_hash: hashOf(['', '', '', '', '']) };
        } else {
          const id = parseInt(appIdRaw, 10);
          if (!Number.isInteger(id)) { info.status = 'App ID must be a number'; stats.errors++; continue; }
          if (seenIds.has(id)) { info.status = 'Duplicate App ID — clear it to add as a new lead'; stats.errors++; continue; }
          rider = ridersById[id] || await db.getRider(id);
          if (!rider) { info.status = 'Lead not found — clear the App ID to add it as new'; stats.errors++; continue; }
          mapping = syncRows[id] || { lead_hash: '', call_hash: '' };

          if (leadHash !== mapping.lead_hash) {
            if (!isValidPhone(phone)) { info.status = 'Needs a valid phone number'; stats.errors++; continue; }
            let staff = { id: rider.added_by_marketer_id, name: rider.added_by_marketer_name };
            if (assigned) {
              const resolved = resolveStaff(assigned, staffList, null);
              if (resolved.error) { info.status = resolved.error; stats.errors++; continue; }
              staff = resolved.staff;
            }
            await db.updateRiderLeadFields(id, {
              name: name || rider.name, phone: formatPhone(phone), notes: area,
              marketerId: staff.id, marketerName: staff.name
            });
            rider = await db.getRider(id);
            if (mapping.lead_hash) stats.updated++;
          }
        }

        seenIds.add(rider.id);
        info.riderId = rider.id;

        let callHashToStore = mapping.call_hash;
        if (callHash !== mapping.call_hash) {
          if (callBlockUsed) {
            await logCall(rider, callFields, reasonCodes, now);
            stats.callsLogged++;
          }
          callHashToStore = callHash;
        }

        await db.upsertSheetSyncRow(rider.id, leadHash, callHashToStore, now);
        syncRows[rider.id] = { rider_id: rider.id, lead_hash: leadHash, call_hash: callHashToStore };
        info.status = statusText;
      } catch (err) {
        info.status = `Error: ${err.message}`.slice(0, 200);
        stats.errors++;
        console.error(`sheetsSync row ${i + 2}:`, err.message);
      }
    }

    // Refresh from the database now that this run's changes are applied.
    const ridersAfter = await db.getRidersForSheet();
    const ridersAfterById = {};
    ridersAfter.forEach(r => { ridersAfterById[r.id] = r; });
    const summary = await db.getFollowupSummaryByRider();

    // Writes: newly assigned App IDs (column A) and any output cells (K-O)
    // that changed. Each range is written only where something differs.
    const writes = [];
    const idRows = [];
    const outputRows = [];
    const outputValues = {};
    dataRows.forEach((cells, i) => {
      const info = rowInfo[i];
      const rowNumber = i + 2;
      if (info.newId && info.riderId) idRows.push(rowNumber);
      let outputs;
      if (info.riderId && ridersAfterById[info.riderId]) {
        outputs = outputCells(ridersAfterById[info.riderId], summary[info.riderId], info.status || 'Synced');
      } else if (info.status) {
        outputs = ['', '', '', '', info.status];
      } else {
        return;
      }
      const current = cells.slice(INPUT_COLS, TOTAL_COLS);
      if (outputs.some((v, k) => v !== current[k])) {
        outputRows.push(rowNumber);
        outputValues[rowNumber] = outputs;
      }
    });

    groupContiguous(idRows).forEach(([from, to]) => {
      const values = [];
      for (let r = from; r <= to; r++) values.push([rowInfo[r - 2].riderId]);
      writes.push({ range: tabRange(cfg, `A${from}:A${to}`), values });
    });
    groupContiguous(outputRows).forEach(([from, to]) => {
      const values = [];
      for (let r = from; r <= to; r++) values.push(outputValues[r]);
      writes.push({ range: tabRange(cfg, `K${from}:O${to}`), values });
    });
    if (writes.length) {
      await sheetsRequest(cfg, 'post', '/values:batchUpdate', {
        data: { valueInputOption: 'RAW', data: writes }
      });
    }

    // Leads created in the app that aren't on the sheet yet.
    const toAppend = ridersAfter.filter(r => !syncRows[r.id]);
    if (toAppend.length) {
      const values = toAppend.map(r => [
        r.id, r.name, r.phone, r.notes || '', r.added_by_marketer_name || '',
        '', '', '', '', '',
        ...outputCells(r, summary[r.id], 'Synced')
      ]);
      await sheetsRequest(cfg, 'post', `/values/${encodeURIComponent(tabRange(cfg, 'A:O'))}:append`, {
        params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        data: { values }
      });
      for (const r of toAppend) {
        await db.upsertSheetSyncRow(
          r.id,
          hashOf([r.name, r.phone, r.notes || '', r.added_by_marketer_name || '']),
          hashOf(['', '', '', '', '']),
          now
        );
      }
      stats.appended = toAppend.length;
    }

    return { ok: true, rows: dataRows.length, ...stats };
  } finally {
    running = false;
  }
}

function startInterval(intervalMs = 3 * 60 * 1000) {
  if (!isConfigured()) {
    console.log('sheetsSync: GOOGLE_SHEETS_SPREADSHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY not set — Google Sheet sync disabled');
    return;
  }
  const tick = () => runSync().catch(err => console.error('sheetsSync run failed:', err.message));
  tick();
  setInterval(tick, intervalMs);
}

module.exports = { runSync, startInterval, isConfigured, HEADERS };
