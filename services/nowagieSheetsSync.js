// Two-way sync between a Google Sheet and NowagieOps's leads, mirroring
// services/sheetsSync.js (DashSpid) but against the much flatter pipeline:
// New -> Contacted -> Call Booked (Cal.com-verified only, never typed) or
// Not Interested. Uses its own spreadsheet (NOWAGIE_SHEETS_SPREADSHEET_ID)
// but the same Google service account as the DashSpid sheet.
//
// Design rule, same as the DashSpid sync: no cell is ever written from both
// sides. Columns A-I are INPUT (owned by the sheet); columns J-N are OUTPUT
// (owned by the app).
const crypto = require('crypto');
const axios = require('axios');
const db = require('../db/database');
const { nowLagos } = require('../utils/time');

const HEADERS = [
  'App ID', 'Name', 'Phone', 'Business Name', 'Assigned To',
  'Call Outcome', 'Reason', 'Feedback', 'Next Follow-up',
  'Source', 'Calls Logged', 'Last Called', 'Last Feedback', 'Sync Status'
];
const INPUT_COLS = 9; // A-I
const TOTAL_COLS = HEADERS.length; // A-N

const TABS = [
  { id: 'N1', title: 'N1 New - First Contact', goal: 'Goal: make first contact and start the conversation.' },
  { id: 'N2', title: 'N2 Contacted - Get Them to Book', goal: 'Goal: get them to book a free strategy call.' },
  { id: 'BOOKED', title: 'Call Booked', goal: 'Verified via Cal.com -- booked and handed off. No action needed.' },
  { id: 'DEAD', title: 'Not Interested', goal: 'Not interested -- stop calling. Just a record.' }
];

const OUTCOMES = ['No answer', 'Busy - call back', 'Switched off', 'Wrong number', 'Reached', 'Interested', 'Not interested'];
const SOURCE_LABELS = { telemarketer: 'Telemarketer', referral: 'Referral', other: 'Other' };

function tabTitle(id) {
  return TABS.find(t => t.id === id).title;
}

function targetTabId(lead) {
  switch (lead.stage) {
    case 'call_booked': return 'BOOKED';
    case 'not_interested': return 'DEAD';
    case 'contacted': return 'N2';
    default: return 'N1';
  }
}

function tabRange(title, a1) {
  return `'${title.replace(/'/g, "''")}'!${a1}`;
}

function batchGetPath(ranges) {
  return '/values:batchGet?valueRenderOption=FORMATTED_VALUE&' + ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
}

function hashOf(values) {
  return crypto.createHash('sha1').update(JSON.stringify(values)).digest('hex');
}

const EMPTY_CALL_HASH = hashOf(['', '', '', '']);

function cellText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function phoneTail(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-10);
}

function formatPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('44')) return '0' + digits.slice(2);
  if (digits.length === 10) return '0' + digits;
  return digits || String(raw || '').trim();
}

function isValidPhone(raw) {
  return String(raw || '').replace(/\D/g, '').length >= 7;
}

function isYes(str) {
  return /^(y|yes|true|1|✓|x)$/i.test(cellText(str));
}

function resolveStaff(typed, staffList, defaultStaffId) {
  const t = cellText(typed).toLowerCase();
  if (!t) {
    const fallback = defaultStaffId && staffList.find(s => s.id === defaultStaffId);
    return fallback ? { staff: fallback } : { error: 'Fill in "Assigned To" (or set NOWAGIE_SHEETS_DEFAULT_STAFF_ID)' };
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

function groupContiguous(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const groups = [];
  sorted.forEach(n => {
    const last = groups[groups.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else groups.push([n, n]);
  });
  return groups;
}

function outputCells(lead, summary, status) {
  const s = summary || { calls: 0, lastAt: null, lastNotes: null };
  return [
    SOURCE_LABELS[lead.channel] || lead.channel || '',
    String(s.calls),
    s.lastAt ? String(s.lastAt).slice(0, 10) : '',
    s.lastNotes ? String(s.lastNotes).trim().slice(0, 200).trim() : '',
    status
  ];
}

function sheetRow(lead, summary) {
  return [
    lead.id, lead.name, lead.phone || '', lead.business_name || '', lead.added_by_marketer_name || '',
    '', '', '', '',
    ...outputCells(lead, summary, 'Synced')
  ];
}

function leadHashOf(lead) {
  return hashOf([cellText(lead.name), cellText(lead.phone), cellText(lead.business_name), cellText(lead.added_by_marketer_name)]);
}

// ── GOOGLE AUTH + SHEETS REST (same pattern as sheetsSync.js) ────────────────

function normalizePrivateKey(raw) {
  let s = String(raw).trim().replace(/^["']+|["',]+$/g, '');
  s = s.replace(/\\n/g, '\n').replace(/\\/g, '');
  const body = s
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  if (body.length < 200) {
    throw new Error('GOOGLE_PRIVATE_KEY looks empty or truncated');
  }
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
}

function getConfig() {
  const spreadsheetId = process.env.NOWAGIE_SHEETS_SPREADSHEET_ID;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!spreadsheetId || !email || !rawKey) return null;
  let privateKey = null;
  let configError = null;
  try { privateKey = normalizePrivateKey(rawKey); } catch (err) { configError = err.message; }
  return {
    spreadsheetId,
    email,
    privateKey,
    configError,
    defaultStaffId: process.env.NOWAGIE_SHEETS_DEFAULT_STAFF_ID ? parseInt(process.env.NOWAGIE_SHEETS_DEFAULT_STAFF_ID, 10) : null
  };
}

function isConfigured() {
  return !!getConfig();
}

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
      timeout: 60000
    });
    return res.data;
  } catch (err) {
    const detail = err.response && err.response.data && err.response.data.error && err.response.data.error.message;
    throw new Error(detail ? `Google Sheets: ${detail}` : err.message);
  }
}

// ── TAB SETUP ────────────────────────────────────────────────────────────────

const GOAL_COL_START = 16; // Q
const GOAL_COL_END = 26;   // through Z, merged into one banner cell

function goalBannerRequests(sheetId, goalText) {
  if (!goalText) return [];
  const range = { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: GOAL_COL_START, endColumnIndex: GOAL_COL_END };
  return [
    { mergeCells: { range, mergeType: 'MERGE_ALL' } },
    { updateCells: {
        range,
        rows: [{ values: [{
          userEnteredValue: { stringValue: goalText },
          userEnteredFormat: {
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            backgroundColor: { red: 1, green: 0.36, blue: 0 },
            wrapStrategy: 'WRAP',
            verticalAlignment: 'MIDDLE'
          }
        }] }],
        fields: 'userEnteredValue,userEnteredFormat(textFormat,backgroundColor,wrapStrategy,verticalAlignment)'
    } }
  ];
}

function columnRuleRequests(sheetId, reasonLabels) {
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
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: INPUT_COLS, endColumnIndex: TOTAL_COLS }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.96, blue: 0.96 } } }, fields: 'userEnteredFormat.backgroundColor' } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } },
    listRule(5, OUTCOMES),
    listRule(6, reasonLabels)
  ];
}

function formatRequests(sheetId, reasonLabels, goalText) {
  return [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: TOTAL_COLS }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } },
    ...columnRuleRequests(sheetId, reasonLabels),
    ...goalBannerRequests(sheetId, goalText),
    { setBasicFilter: { filter: { range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: TOTAL_COLS } } } }
  ];
}

let rulesHealed = false;

async function reapplyColumnRules(cfg, sheetIds, reasonCodes, tabIds) {
  try {
    const reasonLabels = reasonCodes.map(r => r.label);
    const requests = tabIds.flatMap(id => [
      ...columnRuleRequests(sheetIds[tabTitle(id)], reasonLabels),
      ...goalBannerRequests(sheetIds[tabTitle(id)], TABS.find(t => t.id === id).goal)
    ]);
    await sheetsRequest(cfg, 'post', ':batchUpdate', { data: { requests } });
    return true;
  } catch (err) {
    console.error('nowagieSheetsSync: re-applying column rules failed:', err.message);
    return false;
  }
}

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
    try {
      const reasonLabels = reasonCodes.map(r => r.label);
      const requests = missing.flatMap(t => formatRequests(sheetIds[t.title], reasonLabels, t.goal));
      await sheetsRequest(cfg, 'post', ':batchUpdate', { data: { requests } });
    } catch (err) {
      console.error('nowagieSheetsSync: tab formatting failed:', err.message);
    }
  }
  return sheetIds;
}

// ── SYNC ─────────────────────────────────────────────────────────────────────

let running = false;

function callerId(lead, cfg, staffList) {
  const configured = cfg.defaultStaffId && staffList.some(s => s.id === cfg.defaultStaffId);
  return configured ? cfg.defaultStaffId : lead.added_by_marketer_id;
}

async function logCall(lead, staffId, fields, reasonCodes, now) {
  const before = await db.getNowagieLead(lead.id);
  const reason = resolveReason(fields.reason, reasonCodes);
  const noteText = (reason.extraNote + fields.feedback).trim();

  if (fields.notInterested) await db.markNowagieNotInterested(lead.id, now);
  else await db.markNowagieContacted(lead.id, now);

  const after = await db.getNowagieLead(lead.id);
  await db.addNowagieFollowup({
    lead_id: lead.id,
    staff_id: staffId,
    stage_before: before.stage,
    stage_after: after.stage,
    reason_code: reason.code,
    outcome: fields.outcome ? fields.outcome.slice(0, 30) : null,
    notes: noteText || null,
    next_followup_date: fields.nextFollowup || null,
    source: 'sheet',
    created_at: now
  });
}

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
      .filter(c => col[c.rowNumber - 1] && String(col[c.rowNumber - 1][0]).trim() === String(c.leadId))
      .sort((a, b) => b.rowNumber - a.rowNumber)
      .forEach(c => requests.push({
        deleteDimension: { range: { sheetId: sheetIds[tabTitle(id)], dimension: 'ROWS', startIndex: c.rowNumber - 1, endIndex: c.rowNumber } }
      }));
  });
  if (requests.length) await sheetsRequest(cfg, 'post', ':batchUpdate', { data: { requests } });
  return requests.length;
}

async function runSync() {
  const cfg = getConfig();
  if (!cfg) return { skipped: 'NowagieOps Sheet sync is not configured' };
  if (cfg.configError) throw new Error(cfg.configError);
  if (running) return { skipped: 'A sync is already running' };
  running = true;

  try {
    let syncRowsByLead;
    try {
      syncRowsByLead = await db.getNowagieSheetSyncRows();
    } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE') throw new Error('Run db/migrations/011_nowagieops.sql first');
      throw err;
    }

    const reasonCodes = await db.getNowagieReasonCodes();
    const sheetIds = await ensureTabs(cfg, reasonCodes);

    const read = await sheetsRequest(cfg, 'get', batchGetPath(TABS.map(t => tabRange(t.title, 'A1:N'))));
    const tabProblems = [];
    const headerWrites = [];
    const tabData = {};
    TABS.forEach((t, i) => {
      const values = (read.valueRanges[i] && read.valueRanges[i].values) || [];
      const grid = values.map(r => Array.from({ length: TOTAL_COLS }, (_, k) => cellText(r[k])));
      const first = grid[0] || new Array(TOTAL_COLS).fill('');
      if (first.every(c => !c)) {
        headerWrites.push({ range: tabRange(t.title, 'A1:N1'), values: [HEADERS] });
      } else {
        if (HEADERS.slice(0, INPUT_COLS).some((h, k) => first[k].toLowerCase() !== h.toLowerCase())) {
          tabProblems.push(`"${t.title}": row 1 doesn't match the expected headers, so this tab was skipped`);
          return;
        }
        if (HEADERS.slice(INPUT_COLS).some((h, k) => first[INPUT_COLS + k].toLowerCase() !== h.toLowerCase())) {
          headerWrites.push({ range: tabRange(t.title, `${String.fromCharCode(65 + INPUT_COLS)}1:N1`), values: [HEADERS.slice(INPUT_COLS)] });
        }
      }
      tabData[t.id] = grid.slice(1);
    });
    if (headerWrites.length) {
      await sheetsRequest(cfg, 'post', '/values:batchUpdate', { data: { valueInputOption: 'RAW', data: headerWrites } });
    }

    const staffList = await db.getMarketers();
    const leadsBefore = await db.getAllNowagieLeads();
    const leadsById = {};
    leadsBefore.forEach(l => { leadsById[l.id] = l; });
    const phoneToLead = {};
    leadsBefore.forEach(l => {
      const tail = phoneTail(l.phone);
      if (tail && !phoneToLead[tail]) phoneToLead[tail] = l.id;
    });

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
      const target = leadsById[id] ? targetTabId(leadsById[id]) : null;
      canonical[id] = occurrences[k].find(o => o.tabId === target) || occurrences[k][0];
    });

    const stats = { created: 0, linked: 0, updated: 0, callsLogged: 0, appended: 0, moved: 0, deleted: 0, errors: 0 };
    const now = nowLagos();
    const results = [];

    for (const tabId of Object.keys(tabData)) {
      for (let i = 0; i < tabData[tabId].length; i++) {
        const cells = tabData[tabId][i];
        const rowNumber = i + 2;
        const [appIdRaw, name, phone, businessName, assigned, outcome, reason, feedback, nextFollowup] = cells;
        const info = { tabId, rowNumber, leadId: null, status: '', newId: false, stale: false, redundant: false };
        results.push({ cells, info });

        if (cells.slice(0, INPUT_COLS).every(c => !c)) continue;

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

        const leadHash = hashOf([name, phone, businessName, assigned]);
        const callFields = { outcome, reason, feedback, nextFollowup, notInterested: (outcome || '').toLowerCase() === 'not interested' };
        const callBlockUsed = !!(outcome || reason || feedback || nextFollowup);
        const callHash = hashOf([outcome, reason, feedback, nextFollowup]);

        try {
          let lead;
          let mapping;
          let statusText = 'Synced';

          if (!appIdRaw) {
            if (!isValidPhone(phone) && !cellText(name)) { info.status = 'Needs a name or phone number'; stats.errors++; continue; }
            const tail = phoneTail(phone);
            const existingId = tail ? phoneToLead[tail] : null;
            if (existingId) {
              lead = leadsById[existingId] || await db.getNowagieLead(existingId);
              if (occurrences[existingId]) {
                info.redundant = true;
                statusText = 'Already on the sheet — row removed';
              } else {
                statusText = 'Linked to existing lead';
              }
              stats.linked++;
            } else {
              const resolved = resolveStaff(assigned, staffList, cfg.defaultStaffId);
              if (resolved.error) { info.status = resolved.error; stats.errors++; continue; }
              const phoneStored = phone ? formatPhone(phone) : null;
              const created = await db.addNowagieLead({
                name: name || `Lead ${phoneStored || ''}`.trim(),
                phone: phoneStored,
                email: null,
                business_name: businessName || null,
                notes: null,
                added_by_marketer_id: resolved.staff.id,
                added_by_marketer_name: resolved.staff.name,
                channel: 'telemarketer'
              }, now);
              lead = created;
              if (tail) phoneToLead[tail] = lead.id;
              statusText = `Created · ${resolved.staff.name}`;
              stats.created++;
            }
            info.newId = true;
            mapping = { lead_hash: leadHash, call_hash: EMPTY_CALL_HASH };
          } else {
            const id = parseInt(appIdRaw, 10);
            lead = leadsById[id] || await db.getNowagieLead(id);
            if (!lead) { info.status = 'Lead not found — clear the App ID to add it as new'; stats.errors++; continue; }
            mapping = syncRowsByLead[id] || { lead_hash: '', call_hash: '' };

            if (leadHash !== mapping.lead_hash) {
              let staff = { id: lead.added_by_marketer_id, name: lead.added_by_marketer_name };
              if (assigned) {
                const resolved = resolveStaff(assigned, staffList, null);
                if (resolved.error) { info.status = resolved.error; stats.errors++; continue; }
                staff = resolved.staff;
              }
              await db.updateNowagieLeadFields(id, {
                name: name || lead.name,
                phone: phone ? formatPhone(phone) : lead.phone,
                businessName: businessName || lead.business_name,
                marketerId: staff.id,
                marketerName: staff.name
              });
              lead = await db.getNowagieLead(id);
              if (mapping.lead_hash) stats.updated++;
            }
          }

          info.leadId = lead.id;

          let callHashToStore = mapping.call_hash;
          if (callHash !== mapping.call_hash && lead.stage !== 'call_booked') {
            if (callBlockUsed) {
              await logCall(lead, callerId(lead, cfg, staffList), callFields, reasonCodes, now);
              stats.callsLogged++;
              lead = await db.getNowagieLead(lead.id);
            }
            callHashToStore = callHash;
          }

          if (!info.redundant) {
            await db.upsertNowagieSheetSyncRow(lead.id, leadHash, callHashToStore, now);
            syncRowsByLead[lead.id] = { lead_id: lead.id, lead_hash: leadHash, call_hash: callHashToStore };
          }
          info.status = statusText;
        } catch (err) {
          info.status = `Error: ${err.message}`.slice(0, 200);
          stats.errors++;
          console.error(`nowagieSheetsSync ${tabTitle(tabId)} row ${rowNumber}:`, err.message);
        }
      }
    }

    const leadsAfter = await db.getAllNowagieLeads();
    const leadsAfterById = {};
    leadsAfter.forEach(l => { leadsAfterById[l.id] = l; });
    const summary = await db.getNowagieFollowupSummary();

    const idValues = {};
    const outValues = {};
    const moves = [];
    const removals = [];
    results.forEach(({ cells, info }) => {
      const { tabId, rowNumber } = info;
      if (info.stale) { removals.push({ tabId, rowNumber, leadId: info.staleId }); return; }

      let outputs;
      if (info.leadId && leadsAfterById[info.leadId]) {
        const lead = leadsAfterById[info.leadId];
        if (info.newId) (idValues[tabId] = idValues[tabId] || {})[rowNumber] = lead.id;
        if (info.redundant) { removals.push({ tabId, rowNumber, leadId: lead.id }); return; }
        const target = targetTabId(lead);
        if (target !== tabId) { moves.push({ tabId, rowNumber, lead, target }); return; }
        outputs = outputCells(lead, summary[lead.id], info.status || 'Synced');
      } else if (info.status) {
        outputs = ['', '', '', '', info.status];
      } else {
        return;
      }
      const current = cells.slice(INPUT_COLS, TOTAL_COLS);
      if (outputs.some((v, k) => v !== current[k])) (outValues[tabId] = outValues[tabId] || {})[rowNumber] = outputs;
    });

    const writes = [];
    const outStartCol = String.fromCharCode(65 + INPUT_COLS);
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
        writes.push({ range: tabRange(tabTitle(tabId), `${outStartCol}${from}:N${to}`), values });
      });
    });
    if (writes.length) {
      await sheetsRequest(cfg, 'post', '/values:batchUpdate', { data: { valueInputOption: 'RAW', data: writes } });
    }

    const placed = new Set(Object.keys(occurrences).map(Number));
    results.forEach(({ info }) => { if (info.leadId) placed.add(info.leadId); });
    const appendsByTab = {};
    moves.forEach(m => { (appendsByTab[m.target] = appendsByTab[m.target] || []).push({ lead: m.lead, fromMove: true }); });
    leadsAfter.forEach(l => {
      if (!placed.has(l.id) && !syncRowsByLead[l.id]) {
        (appendsByTab[targetTabId(l)] = appendsByTab[targetTabId(l)] || []).push({ lead: l, fromMove: false });
      }
    });
    const movedIds = new Set();
    for (const tabId of Object.keys(appendsByTab)) {
      if (!tabData[tabId]) continue;
      const items = appendsByTab[tabId];
      await sheetsRequest(cfg, 'post', `/values/${encodeURIComponent(tabRange(tabTitle(tabId), 'A:N'))}:append`, {
        params: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
        data: { values: items.map(it => sheetRow(it.lead, summary[it.lead.id])) }
      });
      for (const it of items) {
        await db.upsertNowagieSheetSyncRow(it.lead.id, leadHashOf(it.lead), EMPTY_CALL_HASH, now);
        syncRowsByLead[it.lead.id] = { lead_id: it.lead.id, lead_hash: leadHashOf(it.lead), call_hash: EMPTY_CALL_HASH };
        if (it.fromMove) { stats.moved++; movedIds.add(it.lead.id); } else stats.appended++;
      }
    }

    const tabsToFormat = rulesHealed
      ? Object.keys(appendsByTab).filter(id => tabData[id])
      : Object.keys(tabData);
    if (tabsToFormat.length && await reapplyColumnRules(cfg, sheetIds, reasonCodes, tabsToFormat)) {
      rulesHealed = true;
    }

    const toRemove = [
      ...moves.filter(m => movedIds.has(m.lead.id)).map(m => ({ tabId: m.tabId, rowNumber: m.rowNumber, leadId: m.lead.id })),
      ...removals
    ];
    stats.deleted = await deleteRows(cfg, sheetIds, toRemove);

    return { ok: true, rows: results.length, leads: leadsAfter.length, tabProblems, ...stats };
  } finally {
    running = false;
  }
}

function startInterval(intervalMs = 3 * 60 * 1000) {
  if (!isConfigured()) {
    console.log('nowagieSheetsSync: NOWAGIE_SHEETS_SPREADSHEET_ID not set — NowagieOps Sheet sync disabled');
    return;
  }
  const tick = () => runSync().catch(err => console.error('nowagieSheetsSync run failed:', err.message));
  tick();
  setInterval(tick, intervalMs);
}

module.exports = { runSync, startInterval, isConfigured, HEADERS, TABS };
