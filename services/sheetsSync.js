// Two-way sync between a Google Sheet and the app's lead data, so leads can be
// bulk-pasted and calls logged in the sheet as easily as in the app.
//
// The sheet has one tab per priority list (the same P6/P1-P5 queues as the
// app), so a telemarketer opens a tab, calls everyone on it, and logs the
// outcome in the row. When a lead advances on the platform their row moves to
// the next stage's tab on the next sync — "the 22 not yet registered" is just
// the P6 tab, shrinking as they register.
//
// Design rule that keeps this conflict-free: no cell is ever written from
// both sides.
//   Columns A-J are INPUT (owned by the sheet): lead details + a call-log
//   block. Changes there flow into the app — new rows become leads, edited
//   details update the lead, and each change to the call-log block becomes a
//   logged contact (followups row), so it shows up in the staff member's own
//   pages and the manager dashboard exactly like a call logged in the app.
//   Columns K-O are OUTPUT (owned by the app): source, calls logged, last
//   called, last feedback, sync status.
//
// What she changed since the last run is detected by hashing each row's input
// values against the hashes stored in sheet_sync_rows. A lead is identified by
// its App ID (column A), never by which tab or row it sits in.
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db/database');
const { nowLagos } = require('../utils/time');

const HEADERS = [
  'App ID', 'Name', 'Phone', 'Area / Notes', 'Assigned To',
  'Call Outcome', 'Reason', 'Feedback', 'Next Follow-up', 'Link Shared?',
  'Source', 'Calls Logged', 'Last Called', 'Last Feedback', 'Sync Status'
];
const INPUT_COLS = 10; // A-J
const TOTAL_COLS = HEADERS.length; // A-O

// Titled by who's in it and what the call is trying to achieve. The id ties a
// tab to the app's priority lists (services/priorityLists.js).
const TABS = [
  { id: 'P6', title: 'P6 New - Register' },
  { id: 'P1', title: 'P1 Registered - Activate' },
  { id: 'P2', title: 'P2 Activated - Share Link' },
  { id: 'P3', title: 'P3 Link Shared - Get Customers' },
  { id: 'P4', title: 'P4 Has Customers - First Order' },
  { id: 'P5', title: 'P5 Ordered - Repeat Order' },
  { id: 'DONE', title: 'Graduated' }
];

const OUTCOMES = ['No answer', 'Busy - call back', 'Switched off', 'Wrong number', 'Reached', 'Interested', 'Not interested'];

const SOURCE_LABELS = {
  field_marketer: 'Field', telemarketer: 'Telemarketer', pioneer: 'Pioneer',
  referral: 'Referral', ads: 'Ads', other: 'Other'
};

function tabTitle(id) {
  return TABS.find(t => t.id === id).title;
}

// Same membership rules as the app's priority lists, computed from the
// rider's current funnel stage.
function targetTabId(r) {
  switch (r.funnel_stage) {
    case 'new': return 'P6';
    case 'registered': return 'P1';
    case 'activated': return 'P2';
    case 'link_shared': return 'P3';
    case 'customer_activity': return 'P4';
    case 'first_order':
    case 'completed_order': return r.repeat_business_order_at ? 'DONE' : 'P5';
    default: return 'P6';
  }
}

// The key gets mangled in many ways when pasted into an env-var panel:
// literal "\n" sequences, real newlines turned into spaces, wrapping quotes,
// a trailing comma copied from the JSON, or a stray backslash. All of them
// still contain the same base64 body, so pull that out and rebuild a
// correctly wrapped PEM instead of trusting the pasted formatting.
function normalizePrivateKey(raw) {
  let s = String(raw).trim().replace(/^["']+|["',]+$/g, '');
  s = s.replace(/\\n/g, '\n').replace(/\\/g, '');
  const body = s
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  if (body.length < 200) {
    throw new Error('GOOGLE_PRIVATE_KEY looks empty or truncated — paste the whole "private_key" value from the service account JSON');
  }
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function getConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!spreadsheetId || !email || !rawKey) return null;
  // A bad key must fail a sync run with a readable message, never the app's
  // startup — so the error is carried on the config instead of thrown here.
  let privateKey = null;
  let configError = null;
  try { privateKey = normalizePrivateKey(rawKey); } catch (err) { configError = err.message; }
  return {
    spreadsheetId,
    email,
    privateKey,
    configError,
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

// path is appended straight to /spreadsheets/{id}, so it may be '' (the
// spreadsheet itself), ':batchUpdate', '/values:batchGet?...', etc.
async function sheetsRequest(cfg, method, path, { params, data } = {}) {
  const token = await getAccessToken(cfg);
  try {
    const res = await axios({
      method,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${cfg.spreadsheetId}${path}`,
      params,
      data,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60000
    });
    return res.data;
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.error && err.response.data.error.message;
    throw new Error(detail ? `Google Sheets: ${detail}` : err.message);
  }
}

function tabRange(title, a1) {
  return `'${title.replace(/'/g, "''")}'!${a1}`;
}

function batchGetPath(ranges) {
  return '/values:batchGet?valueRenderOption=FORMATTED_VALUE&' + ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
}

// ── SMALL HELPERS ────────────────────────────────────────────────────────────

function hashOf(values) {
  return crypto.createHash('sha1').update(JSON.stringify(values)).digest('hex');
}

const EMPTY_CALL_HASH = hashOf(['', '', '', '', '']);

function cellText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function phoneTail(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

// A phone pasted into a non-text cell loses its leading zero (08012345678
// becomes the number 8012345678) — put it back so leads are stored the way
// the rest of the app expects, and convert +234 forms.
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
// date where both parts could be a month, day-first wins (Nigeria).
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
    SOURCE_LABELS[rider.channel] || rider.channel || '',
    String(s.calls),
    s.lastAt ? String(s.lastAt).slice(0, 10) : '',
    s.lastNotes ? String(s.lastNotes).trim().slice(0, 200).trim() : '',
    status
  ];
}

function sheetRow(rider, summary) {
  return [
    rider.id, rider.name, rider.phone, rider.notes || '', rider.added_by_marketer_name || '',
    '', '', '', '', '',
    ...outputCells(rider, summary, 'Synced')
  ];
}

// Built from the same trimmed text a read-back of the sheet produces, so a
// stray trailing space in a note doesn't look like she edited the row.
function leadHashOf(rider) {
  return hashOf([cellText(rider.name), cellText(rider.phone), cellText(rider.notes), cellText(rider.added_by_marketer_name)]);
}

// ── TAB SETUP ────────────────────────────────────────────────────────────────

function formatRequests(sheetId, reasonLabels) {
  const listRule = (col, values) => ({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: col, endColumnIndex: col + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map(v => ({ userEnteredValue: v })) },
        showCustomUi: true,
        strict: false
      }
    }
  });
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    // Output columns shaded so it's clear they're written by the app.
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: INPUT_COLS, endColumnIndex: TOTAL_COLS }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.96, blue: 0.96 } } }, fields: 'userEnteredFormat.backgroundColor' } },
    // Plain-text phone column keeps the leading zero; ISO dates keep the
    // follow-up column unambiguous whatever the spreadsheet's locale.
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } },
    listRule(5, OUTCOMES),
    listRule(6, reasonLabels),
    listRule(9, ['Yes', 'No']),
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: TOTAL_COLS } } } }
  ];
}

// Makes sure every stage tab exists (creating and formatting missing ones)
// and returns a title -> sheetId map.
async function ensureTabs(cfg, reasonCodes) {
  const meta = await sheetsRequest(cfg, 'get', '', { params: { fields: 'sheets.properties(sheetId,title)' } });
  const sheetIds = {};
  (meta.sheets || []).forEach(s => { sheetIds[s.properties.title] = s.properties.sheetId; });

  const missing = TABS.filter(t => !(t.title in sheetIds));
  if (missing.length) {
    const res = await sheetsRequest(cfg, 'post', ':batchUpdate', {
      data: { requests: missing.map(t => ({ addSheet: { properties: { title: t.title } } })) }
    });
    res.replies.forEach((rep, i) => { sheetIds[missing[i].title] = rep.addSheet.properties.sheetId; });
    // Cosmetic only — a formatting failure must never stop the sync itself.
    try {
      const reasonLabels = reasonCodes.map(r => r.label);
      const requests = missing.flatMap(t => formatRequests(sheetIds[t.title], reasonLabels));
      await sheetsRequest(cfg, 'post', ':batchUpdate', { data: { requests } });
    } catch (err) {
      console.error('sheetsSync: tab formatting failed:', err.message);
    }
  }
  return sheetIds;
}

// ── SYNC ─────────────────────────────────────────────────────────────────────

let running = false;

// Who a call typed into the sheet counts for. The sheet has no logins, so it
// can't know who typed — but it's the telemarketer's tool, so calls are
// credited to SHEETS_DEFAULT_STAFF_ID, not to whoever originally sourced the
// lead ("Assigned To" is the lead's owner; a call Ruth makes on a lead a field
// marketer sourced is Ruth's call). Falls back to the lead's owner only when
// no working staff member is configured.
function callerId(rider, cfg, staffList) {
  const configured = cfg.defaultStaffId && staffList.some(s => s.id === cfg.defaultStaffId);
  return configured ? cfg.defaultStaffId : rider.added_by_marketer_id;
}

async function logCall(rider, staffId, fields, reasonCodes, now) {
  const before = await db.getRider(rider.id);
  if (fields.linkShared) await db.confirmLinkShared(rider.id, now);
  const after = await db.getRider(rider.id);
  const reason = resolveReason(fields.reason, reasonCodes);
  const noteText = (reason.extraNote + fields.feedback).trim();
  await db.addSheetFollowup({
    rider_id: rider.id,
    staff_id: staffId,
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

// Deletes rows that have been moved (or were stale duplicates), but only
// after re-reading column A to confirm each row still holds the same App ID —
// if she sorted or inserted rows since the sync read the tab, the row numbers
// are no longer trustworthy and that deletion is skipped (the next run
// notices the leftover and retries).
async function deleteRows(cfg, sheetIds, candidates) {
  const byTab = {};
  candidates.forEach(c => { (byTab[c.tabId] = byTab[c.tabId] || []).push(c); });
  const tabIds = Object.keys(byTab);
  if (!tabIds.length) return 0;

  const current = await sheetsRequest(cfg, 'get', batchGetPath(tabIds.map(id => tabRange(tabTitle(id), 'A1:A'))));
  const requests = [];
  tabIds.forEach((id, i) => {
    const col = (current.valueRanges[i] && current.valueRanges[i].values) || [];
    byTab[id]
      .filter(c => col[c.rowNumber - 1] && String(col[c.rowNumber - 1][0]).trim() === String(c.riderId))
      .sort((a, b) => b.rowNumber - a.rowNumber) // bottom-up so earlier deletions don't shift later ones
      .forEach(c => requests.push({
        deleteDimension: { range: { sheetId: sheetIds[tabTitle(id)], dimension: 'ROWS', startIndex: c.rowNumber - 1, endIndex: c.rowNumber } }
      }));
  });
  if (requests.length) await sheetsRequest(cfg, 'post', ':batchUpdate', { data: { requests } });
  return requests.length;
}

async function runSync() {
  const cfg = getConfig();
  if (!cfg) return { skipped: 'Google Sheet sync is not configured' };
  if (cfg.configError) throw new Error(cfg.configError);
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

    const reasonCodes = await db.getReasonCodes();
    const sheetIds = await ensureTabs(cfg, reasonCodes);

    // Read every stage tab in one request.
    const read = await sheetsRequest(cfg, 'get', batchGetPath(TABS.map(t => tabRange(t.title, 'A1:O'))));
    const tabProblems = [];
    const headerWrites = [];
    const tabData = {}; // tab id -> data rows (header excluded); row n is at index n-2
    TABS.forEach((t, i) => {
      const values = (read.valueRanges[i] && read.valueRanges[i].values) || [];
      const grid = values.map(r => Array.from({ length: TOTAL_COLS }, (_, k) => cellText(r[k])));
      const first = grid[0] || new Array(TOTAL_COLS).fill('');
      if (first.every(c => !c)) {
        headerWrites.push({ range: tabRange(t.title, 'A1:O1'), values: [HEADERS] });
      } else {
        if (HEADERS.slice(0, INPUT_COLS).some((h, k) => first[k].toLowerCase() !== h.toLowerCase())) {
          tabProblems.push(`"${t.title}": row 1 doesn't match the expected headers, so this tab was skipped`);
          return;
        }
        if (HEADERS.slice(INPUT_COLS).some((h, k) => first[INPUT_COLS + k].toLowerCase() !== h.toLowerCase())) {
          headerWrites.push({ range: tabRange(t.title, 'K1:O1'), values: [HEADERS.slice(INPUT_COLS)] });
        }
      }
      tabData[t.id] = grid.slice(1);
    });
    if (headerWrites.length) {
      await sheetsRequest(cfg, 'post', '/values:batchUpdate', { data: { valueInputOption: 'RAW', data: headerWrites } });
    }

    const staffList = await db.getMarketers();
    const ridersBefore = await db.getRidersForSheet();
    const ridersById = {};
    ridersBefore.forEach(r => { ridersById[r.id] = r; });
    const phoneToRider = {};
    (await db.getAllRiderPhones()).forEach(r => {
      const tail = phoneTail(r.phone);
      if (tail && !phoneToRider[tail]) phoneToRider[tail] = r.id;
    });

    // Where each lead currently sits. A lead can end up on two tabs if a
    // previous run moved it but couldn't delete the old row; the row on the
    // tab it belongs on is the real one and the other is a stale leftover.
    const occurrences = {};
    Object.keys(tabData).forEach(tabId => {
      tabData[tabId].forEach((cells, i) => {
        if (/^\d+$/.test(cells[0])) {
          const id = parseInt(cells[0], 10);
          (occurrences[id] = occurrences[id] || []).push({ tabId, rowNumber: i + 2 });
        }
      });
    });
    const canonical = {};
    Object.keys(occurrences).forEach(k => {
      const id = Number(k);
      const target = ridersById[id] ? targetTabId(ridersById[id]) : null;
      canonical[id] = occurrences[k].find(o => o.tabId === target) || occurrences[k][0];
    });

    const stats = { created: 0, linked: 0, updated: 0, callsLogged: 0, appended: 0, moved: 0, deleted: 0, errors: 0 };
    const now = nowLagos();
    const results = [];

    for (const tabId of Object.keys(tabData)) {
      for (let i = 0; i < tabData[tabId].length; i++) {
        const cells = tabData[tabId][i];
        const rowNumber = i + 2;
        const [appIdRaw, name, phone, area, assigned, outcome, reason, feedback, nextFollowup, linkSharedRaw] = cells;
        const info = { tabId, rowNumber, riderId: null, status: '', newId: false, stale: false, redundant: false };
        results.push({ cells, info });

        if (cells.slice(0, INPUT_COLS).every(c => !c)) continue; // blank row

        if (appIdRaw) {
          if (!/^\d+$/.test(appIdRaw)) { info.status = 'App ID must be a number'; stats.errors++; continue; }
          const id = parseInt(appIdRaw, 10);
          const canon = canonical[id];
          if (canon && !(canon.tabId === tabId && canon.rowNumber === rowNumber)) {
            if (canon.tabId !== tabId) { info.stale = true; info.staleId = id; }
            else { info.status = 'Duplicate App ID — clear it to add as a new lead'; stats.errors++; }
            continue;
          }
        }

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
              if (occurrences[existingId]) {
                // Already has its own row somewhere — apply any call she typed
                // here to that lead, then this duplicate row is deleted.
                info.redundant = true;
                statusText = 'Already on the sheet — row removed';
              } else {
                statusText = 'Linked to existing lead';
              }
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
            mapping = { lead_hash: leadHash, call_hash: EMPTY_CALL_HASH };
          } else {
            const id = parseInt(appIdRaw, 10);
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

          info.riderId = rider.id;

          let callHashToStore = mapping.call_hash;
          if (callHash !== mapping.call_hash) {
            if (callBlockUsed) {
              await logCall(rider, callerId(rider, cfg, staffList), callFields, reasonCodes, now);
              stats.callsLogged++;
            }
            callHashToStore = callHash;
          }

          // A redundant duplicate row never becomes the lead's mapped row.
          if (!info.redundant) {
            await db.upsertSheetSyncRow(rider.id, leadHash, callHashToStore, now);
            syncRows[rider.id] = { rider_id: rider.id, lead_hash: leadHash, call_hash: callHashToStore };
          }
          info.status = statusText;
        } catch (err) {
          info.status = `Error: ${err.message}`.slice(0, 200);
          stats.errors++;
          console.error(`sheetsSync ${tabTitle(tabId)} row ${rowNumber}:`, err.message);
        }
      }
    }

    // Refresh from the database now that this run's changes are applied.
    const ridersAfter = await db.getRidersForSheet();
    const ridersAfterById = {};
    ridersAfter.forEach(r => { ridersAfterById[r.id] = r; });
    const summary = await db.getFollowupSummaryByRider();

    // Decide what stays, what moves to another tab, and what is just a stale
    // or redundant row to remove.
    const idValues = {};   // tab id -> { rowNumber: riderId }
    const outValues = {};  // tab id -> { rowNumber: [5 output cells] }
    const moves = [];
    const removals = [];
    results.forEach(({ cells, info }) => {
      const { tabId, rowNumber } = info;
      if (info.stale) { removals.push({ tabId, rowNumber, riderId: info.staleId }); return; }

      let outputs;
      if (info.riderId && ridersAfterById[info.riderId]) {
        const rider = ridersAfterById[info.riderId];
        if (info.newId) (idValues[tabId] = idValues[tabId] || {})[rowNumber] = rider.id;
        if (info.redundant) { removals.push({ tabId, rowNumber, riderId: rider.id }); return; }
        const target = targetTabId(rider);
        if (target !== tabId) { moves.push({ tabId, rowNumber, rider, target }); return; }
        outputs = outputCells(rider, summary[rider.id], info.status || 'Synced');
      } else if (info.status) {
        outputs = ['', '', '', '', info.status];
      } else {
        return;
      }
      const current = cells.slice(INPUT_COLS, TOTAL_COLS);
      if (outputs.some((v, k) => v !== current[k])) (outValues[tabId] = outValues[tabId] || {})[rowNumber] = outputs;
    });

    // Write newly assigned App IDs and any changed output cells.
    const writes = [];
    Object.keys(idValues).forEach(tabId => {
      groupContiguous(Object.keys(idValues[tabId]).map(Number)).forEach(([from, to]) => {
        const values = [];
        for (let r = from; r <= to; r++) values.push([idValues[tabId][r]]);
        writes.push({ range: tabRange(tabTitle(tabId), `A${from}:A${to}`), values });
      });
    });
    Object.keys(outValues).forEach(tabId => {
      groupContiguous(Object.keys(outValues[tabId]).map(Number)).forEach(([from, to]) => {
        const values = [];
        for (let r = from; r <= to; r++) values.push(outValues[tabId][r]);
        writes.push({ range: tabRange(tabTitle(tabId), `K${from}:O${to}`), values });
      });
    });
    if (writes.length) {
      await sheetsRequest(cfg, 'post', '/values:batchUpdate', { data: { valueInputOption: 'RAW', data: writes } });
    }

    // Everything that needs a new row: leads moving to another stage's tab,
    // plus leads that were never on the sheet (created in the app). A lead
    // that has a mapping but isn't on any tab had its row deleted on purpose,
    // so it is not re-added.
    const placed = new Set(Object.keys(occurrences).map(Number));
    results.forEach(({ info }) => { if (info.riderId) placed.add(info.riderId); });
    const appendsByTab = {};
    moves.forEach(m => { (appendsByTab[m.target] = appendsByTab[m.target] || []).push({ rider: m.rider, fromMove: true }); });
    ridersAfter.forEach(r => {
      if (!placed.has(r.id) && !syncRows[r.id]) {
        (appendsByTab[targetTabId(r)] = appendsByTab[targetTabId(r)] || []).push({ rider: r, fromMove: false });
      }
    });
    const movedIds = new Set(); // moves whose new row was actually written
    for (const tabId of Object.keys(appendsByTab)) {
      if (!tabData[tabId]) continue; // that tab had a header problem
      const items = appendsByTab[tabId];
      await sheetsRequest(cfg, 'post', `/values/${encodeURIComponent(tabRange(tabTitle(tabId), 'A:O'))}:append`, {
        params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        data: { values: items.map(it => sheetRow(it.rider, summary[it.rider.id])) }
      });
      for (const it of items) {
        await db.upsertSheetSyncRow(it.rider.id, leadHashOf(it.rider), EMPTY_CALL_HASH, now);
        syncRows[it.rider.id] = { rider_id: it.rider.id, lead_hash: leadHashOf(it.rider), call_hash: EMPTY_CALL_HASH };
        if (it.fromMove) { stats.moved++; movedIds.add(it.rider.id); } else stats.appended++;
      }
    }

    // Only now remove the old copies (moved rows, stale leftovers, redundant
    // pasted duplicates) — after the new rows are safely written. A move whose
    // destination couldn't be written keeps its old row.
    const toRemove = [
      ...moves.filter(m => movedIds.has(m.rider.id)).map(m => ({ tabId: m.tabId, rowNumber: m.rowNumber, riderId: m.rider.id })),
      ...removals
    ];
    stats.deleted = await deleteRows(cfg, sheetIds, toRemove);

    return { ok: true, rows: results.length, tabProblems, ...stats };
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

module.exports = { runSync, startInterval, isConfigured, HEADERS, TABS };
