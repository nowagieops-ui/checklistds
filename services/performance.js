// Aggregate metrics for the "My Performance" (staff) and Management Overview
// / Staff Performance (manager) screens. Every number here is a direct
// COUNT/SUM over riders.<stage>_at IS NOT NULL or a date-range filter on it —
// nothing here is estimated or invented, per the "do not invent customer
// visits or orders the system cannot verify" rule.
const db = require('../db/database');
const priorityLists = require('./priorityLists');

const STAGE_COLUMNS = [
  { key: 'registrations', column: 'registered_at' },
  { key: 'activations', column: 'activated_at' },
  { key: 'links_shared', column: 'link_shared_at' },
  { key: 'customer_activity', column: 'first_activity_at' },
  { key: 'first_orders', column: 'first_order_at' },
  { key: 'completed_orders', column: 'completed_order_at' },
  { key: 'repeat_business_orders', column: 'repeat_business_order_at' },
  { key: 'repeat_customer_businesses', column: 'first_repeat_customer_at' }
];

function sumCase(column, alias) {
  return `SUM(CASE WHEN ${column} IS NOT NULL THEN 1 ELSE 0 END) AS ${alias}`;
}

// Company-wide numbers, either as an all-time running total (omit
// fromDate/toDate — matches the spec's Management Overview sample, e.g.
// "184 activated businesses") or scoped to a date range (pass both — same
// flow view as getStaffScorecard, just company-wide). biggestLeak is always
// the live snapshot regardless of period, since "who's stuck right now" in
// a priority list isn't itself a historical-range concept.
async function getCompanyOverview(fromDate, toDate) {
  const ranged = fromDate && toDate;
  const selects = STAGE_COLUMNS.map(s =>
    ranged
      ? `SUM(CASE WHEN ${s.column} IS NOT NULL AND DATE(${s.column}) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS ${s.key}`
      : sumCase(s.column, s.key)
  ).join(', ');
  const params = ranged ? STAGE_COLUMNS.flatMap(() => [fromDate, toDate]) : [];

  // total_link_shares/total_unique_visitors are cumulative running totals
  // synced onto each rider (not date-stamped events in MySQL), so these two
  // are always all-time regardless of the requested period — labeled as
  // such wherever they're shown.
  const rows = await db.query(
    `SELECT COUNT(*) AS total_prospects, SUM(repeat_customer_count) AS total_repeat_customers,
            SUM(link_share_count) AS total_link_shares, SUM(unique_visitor_count) AS total_unique_visitors,
            ${selects} FROM riders`,
    params
  );
  const biggestLeak = (await priorityLists.getAllListCounts(null)).sort((a, b) => b.count - a.count)[0];
  return { ...rows[0], biggestLeak };
}

// Cohort conversion: of everyone who REGISTERED within this window, how
// many have (as of right now, regardless of when it happened) reached each
// later stage. Deliberately different from getCompanyOverview above, which
// counts each stage's own event date independently of registration date —
// this answers "how well is this batch of signups actually converting,"
// which is what a ratio display needs as its denominator. Omit
// fromDate/toDate for the all-time cohort (everyone ever registered).
async function getCohortOverview(fromDate, toDate) {
  const ranged = fromDate && toDate;
  const where = ranged ? 'WHERE registered_at IS NOT NULL AND DATE(registered_at) BETWEEN ? AND ?' : 'WHERE registered_at IS NOT NULL';
  const params = ranged ? [fromDate, toDate] : [];

  const [row] = await db.query(
    `SELECT COUNT(*) AS cohort_size,
            SUM(CASE WHEN activated_at IS NOT NULL THEN 1 ELSE 0 END) AS activated,
            SUM(CASE WHEN link_shared_at IS NOT NULL THEN 1 ELSE 0 END) AS link_shared,
            SUM(CASE WHEN first_activity_at IS NOT NULL THEN 1 ELSE 0 END) AS customer_activity,
            SUM(CASE WHEN first_order_at IS NOT NULL THEN 1 ELSE 0 END) AS first_order,
            SUM(CASE WHEN completed_order_at IS NOT NULL THEN 1 ELSE 0 END) AS completed_order,
            SUM(CASE WHEN repeat_business_order_at IS NOT NULL THEN 1 ELSE 0 END) AS repeat_order,
            SUM(CASE WHEN first_repeat_customer_at IS NOT NULL THEN 1 ELSE 0 END) AS repeat_customer_businesses
     FROM riders ${where}`,
    params
  );
  return row;
}

// Channel rollup (field_marketer/telemarketer/pioneer/referral/ads/other) —
// channel is purely an attribution dimension on riders, never part of the
// funnel-stage definition itself (see plan).
async function getChannelBreakdown() {
  const selects = STAGE_COLUMNS.map(s => sumCase(s.column, s.key)).join(', ');
  return db.query(`SELECT channel, COUNT(*) AS total_prospects, ${selects} FROM riders GROUP BY channel ORDER BY total_prospects DESC`);
}

// One row per active staff member (field marketer or telemarketer),
// their overall attribution totals plus their own P1-P6 counts — the L3
// drill-down source for the manager dashboard.
async function getStaffBreakdown() {
  const marketers = (await db.getMarketers()).filter(m => m.role !== 'manager');
  const selects = STAGE_COLUMNS.map(s => sumCase(s.column, s.key)).join(', ');
  const result = [];
  for (const m of marketers) {
    const [totals] = await db.query(
      `SELECT COUNT(*) AS total_prospects, ${selects} FROM riders WHERE added_by_marketer_id = ?`,
      [m.id]
    );
    const priorityCounts = await priorityLists.getAllListCounts(m.id);
    result.push({ id: m.id, name: m.name, role: m.role, ...totals, priorityCounts });
  }
  return result;
}

// Date-range scorecard for one staff member's own "My Performance" screen —
// this is the flow view (what moved in this window), unlike the company
// overview above, which is a snapshot.
async function getStaffScorecard(marketerId, fromDate, toDate) {
  const selects = STAGE_COLUMNS.map(s =>
    `SUM(CASE WHEN ${s.column} IS NOT NULL AND DATE(${s.column}) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS ${s.key}`
  ).join(', ');
  const params = [];
  STAGE_COLUMNS.forEach(() => params.push(fromDate, toDate));
  params.push(marketerId);

  const [totals] = await db.query(
    `SELECT ${selects} FROM riders WHERE added_by_marketer_id = ?`,
    params
  );

  const [followupTotals] = await db.query(
    `SELECT COUNT(*) AS followups FROM followups WHERE staff_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
    [marketerId, fromDate, toDate]
  );

  const priorityCounts = await priorityLists.getAllListCounts(marketerId);
  const biggestLeak = [...priorityCounts].sort((a, b) => b.count - a.count)[0];

  return { ...totals, followups: followupTotals.followups, priorityCounts, biggestLeak };
}

// "200 calls, 3 moved a stage" — the roll-up the spec insists a raw call
// count must be shown alongside (§8: "a total call count may be shown only
// as a roll-up"). moved_stage counts a followup only where the funnel stage
// actually changed, so a quick-call tick (which never changes stage) or a
// full follow-up that didn't move anything both correctly count as "no
// movement," not silently as a win.
async function getTodayCallSummary(staffId, todayDate) {
  const [row] = await db.query(
    `SELECT COUNT(*) AS total_calls, SUM(CASE WHEN stage_before <> stage_after THEN 1 ELSE 0 END) AS moved_stage
     FROM followups WHERE staff_id = ? AND DATE(created_at) = ?`,
    [staffId, todayDate]
  );
  return { total_calls: row.total_calls, moved_stage: row.moved_stage || 0 };
}

module.exports = { getCompanyOverview, getCohortOverview, getChannelBreakdown, getStaffBreakdown, getStaffScorecard, getTodayCallSummary };
