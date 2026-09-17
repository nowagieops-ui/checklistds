// Core Priority Lists (P1-P6) — computed live from riders.funnel_stage on
// every call, never stored. Membership is purely a function of the current
// funnel stage; channel/staff attribution (added_by_marketer_id) is only
// ever a filter on top, never part of what defines a list. See the growth-OS
// implementation plan's "Architecture Decision" section for why.
//
// Each list orders by the timestamp that put a prospect INTO its current
// stage, oldest first — whoever has been sitting in a stage longest is the
// most urgent to work, which is the same "surface the leak" intent as the
// spec's queue-age/leakage tracking.
const db = require('../db/database');

const LISTS = {
  P1: {
    label: 'Registered, Not Activated',
    objective: 'Complete activation',
    stage: 'registered',
    orderByColumn: 'registered_at'
  },
  P2: {
    label: 'Activated, Link Not Shared',
    objective: 'Get the storefront link shared',
    stage: 'activated',
    orderByColumn: 'activated_at'
  },
  P3: {
    label: 'Link Shared, No Customer Activity',
    objective: 'Generate real customer visits/use',
    stage: 'link_shared',
    orderByColumn: 'link_shared_at'
  },
  P4: {
    label: 'Customer Activity, No Order',
    objective: 'Diagnose friction, convert first order',
    stage: 'customer_activity',
    orderByColumn: 'first_activity_at'
  },
  P5: {
    label: 'First Order, No Repeat',
    objective: 'Generate repeat order or diagnose issue',
    stages: ['first_order', 'completed_order'],
    extraWhere: 'repeat_business_order_at IS NULL',
    orderByColumn: 'first_order_at'
  },
  P6: {
    label: 'New / Warm Prospects',
    objective: 'Move to registration, then activation',
    stage: 'new',
    orderByColumn: 'created_at'
  }
};

function listIds() {
  return Object.keys(LISTS);
}

function listMeta(listId) {
  const def = LISTS[listId];
  if (!def) return null;
  return { id: listId, label: def.label, objective: def.objective };
}

// marketerId: scopes to one staff member's own prospects (added_by_marketer_id)
// — pass null/undefined for the company-wide view (manager dashboard).
async function getListRows(listId, marketerId) {
  const def = LISTS[listId];
  if (!def) throw new Error(`Unknown priority list: ${listId}`);

  const stages = def.stages || [def.stage];
  const placeholders = stages.map(() => '?').join(', ');
  const params = [...stages];

  let sql = `SELECT * FROM riders WHERE funnel_stage IN (${placeholders})`;
  if (def.extraWhere) sql += ` AND ${def.extraWhere}`;
  if (marketerId) {
    sql += ' AND added_by_marketer_id = ?';
    params.push(marketerId);
  }
  sql += ` ORDER BY ${def.orderByColumn} ASC`;

  return db.query(sql, params);
}

async function getListCount(listId, marketerId) {
  const rows = await getListRows(listId, marketerId);
  return rows.length;
}

// One count per list, in list order — what both the field marketer's "My
// Priority Lists" screen and the telemarketer's "Today's Call Queue" screen
// render as their tab/queue headers.
async function getAllListCounts(marketerId) {
  const result = [];
  for (const id of listIds()) {
    const rows = await getListRows(id, marketerId);
    result.push({ ...listMeta(id), count: rows.length });
  }
  return result;
}

// The full roster, unlike the priority lists above: every prospect this
// scope has ever worked, regardless of current stage — including ones who
// have fully "graduated" past P6 (a repeat business, say) and so no longer
// appear in any P1-P6 queue. That's deliberate for the queues (nothing to
// action there), but a staff member still wants to see everyone they've
// ever spoken to, converted or not.
async function getAllProspects(marketerId) {
  let sql = 'SELECT * FROM riders';
  const params = [];
  if (marketerId) {
    sql += ' WHERE added_by_marketer_id = ?';
    params.push(marketerId);
  }
  sql += ' ORDER BY created_at DESC';
  return db.query(sql, params);
}

module.exports = { LISTS, listIds, listMeta, getListRows, getListCount, getAllListCounts, getAllProspects };
