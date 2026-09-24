// NowagieOps's call queue — much flatter than DashSpid's P1-P6 (see
// services/priorityLists.js): there's no platform to sync stage changes
// against, and "call_booked" only ever comes from the Cal.com sync, never
// self-reported. Only the two lists with something left to action are
// queues at all — a booked call or a not-interested lead has nothing more
// for her to do here.
const db = require('../db/database');

const LISTS = {
  N1: {
    label: 'New Leads',
    objective: 'Make first contact',
    stage: 'new',
    orderByColumn: 'created_at'
  },
  N2: {
    label: 'Contacted, Not Booked',
    objective: 'Get them to book a free strategy call',
    stage: 'contacted',
    orderByColumn: 'contacted_at'
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

async function getListRows(listId) {
  const def = LISTS[listId];
  if (!def) throw new Error(`Unknown NowagieOps list: ${listId}`);
  return db.query(
    `SELECT * FROM nowagie_leads WHERE stage = ? ORDER BY ${def.orderByColumn} ASC`,
    [def.stage]
  );
}

async function getAllListCounts() {
  const result = [];
  for (const id of listIds()) {
    const rows = await getListRows(id);
    result.push({ ...listMeta(id), count: rows.length });
  }
  return result;
}

// Full roster — every lead regardless of stage, including booked and
// not-interested ones, for the "everyone I've ever called" view.
async function getAllLeads() {
  return db.query('SELECT * FROM nowagie_leads ORDER BY created_at DESC');
}

module.exports = { LISTS, listIds, listMeta, getListRows, getAllListCounts, getAllLeads };
