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

module.exports = { lagosParts, today, nowLagos, toLagosDateTime, formatDate, formatDateShort, formatDateLong, formatTime };
