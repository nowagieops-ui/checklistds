// Everything time-related is pinned to Africa/Lagos explicitly, never left
// to the server's own timezone. The app runs on shared hosting whose local
// time isn't guaranteed, and a mismatch between how a timestamp gets
// written (e.g. MySQL's NOW(), or a JS Date's default local formatting)
// and how "today" gets computed on read can make a same-day record vanish
// from date-range queries entirely — that's what was happening.
function lagosParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}
function today() {
  const p = lagosParts();
  return `${p.year}-${p.month}-${p.day}`;
}
// Lagos wall-clock datetime as 'YYYY-MM-DD HH:MM:SS', for writing to
// DATETIME columns instead of relying on MySQL's NOW().
function nowLagos() {
  return toLagosDateTime(new Date());
}
// Converts any JS Date or parseable timestamp (e.g. a Supabase/Postgres
// ISO string) to the same 'YYYY-MM-DD HH:MM:SS' Lagos wall-clock format —
// for stamping funnel timestamps from a real platform event time rather
// than "whenever the sync happened to run".
function toLagosDateTime(input) {
  const p = lagosParts(input instanceof Date ? input : new Date(input));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function formatDate() {
  return new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function formatDateShort(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short' });
}
function formatDateLong(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
// datetimeStr is already a 'YYYY-MM-DD HH:MM:SS' Lagos wall-clock string
// (see nowLagos() above), so this is a plain substring — no further
// timezone conversion needed or wanted.
function formatTime(datetimeStr) {
  return datetimeStr.slice(11, 16);
}

// Pure UTC date-string arithmetic — matches today()'s UTC convention and
// avoids local-vs-UTC date parsing mismatches shifting a date by a day.
function addDaysUTC(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split('T')[0];
}

// Whole days between a 'YYYY-MM-DD...' timestamp and today (Lagos), for
// "how long has this prospect been sitting in this stage" on the
// priority-list screens. Date-only arithmetic (like addDaysUTC elsewhere in
// this codebase) — deliberately ignores time-of-day, so this is a day
// count, not a precise duration.
function daysSince(datetimeStr) {
  if (!datetimeStr) return null;
  const [y1, m1, d1] = datetimeStr.slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = today().split('-').map(Number);
  const then = Date.UTC(y1, m1 - 1, d1);
  const now = Date.UTC(y2, m2 - 1, d2);
  return Math.round((now - then) / 86400000);
}

module.exports = { lagosParts, today, nowLagos, toLagosDateTime, daysSince, addDaysUTC, formatDate, formatDateShort, formatDateLong, formatTime };
