// Loads the 12-week telemarketer training program and normalizes every
// week's content into one consistent shape for the client renderer.
//
// Each week's raw data file (data/trainingWeeks/weekNN.js) was authored
// separately and uses inconsistent field names: Week 1 uses
// header/options/answer/prospect/objection, while weeks 2-12 use the
// shorter h/opts/ans/p/o — and weeks 2+ introduce block types Week 1 never
// had (eg/sc/steps). Rather than scatter `field || altField` fallbacks
// through the EJS template, everything is normalized once here so the
// client always sees the same shape regardless of which week it's viewing.
const path = require('path');

// Two independent curricula share this one engine/renderer — only the data
// directory and week count differ. 'dashspid' is the default everywhere
// existing callers don't pass a track, so nothing about the original
// 12-week academy changes.
const TRACKS = {
  dashspid: { dir: 'trainingWeeks', totalWeeks: 12 },
  nowagieops: { dir: 'trainingWeeksNowagieOps', totalWeeks: 8 }
};

const TOTAL_WEEKS = TRACKS.dashspid.totalWeeks;

function totalWeeksFor(track) {
  return TRACKS[track || 'dashspid'].totalWeeks;
}

function loadWeekRaw(weekNumber, track) {
  const file = `week${String(weekNumber).padStart(2, '0')}.js`;
  return require(path.join(__dirname, '..', 'data', TRACKS[track || 'dashspid'].dir, file));
}

// A content block is one of: {type:'table', headers, rows}, {callout},
// {example:{label,text}}, {script:{label,text,response}},
// {header, steps:[{num,title,body}]}, or {header, body, bullets}.
function normalizeBlock(b) {
  if (b.type === 'table') return { type: 'table', headers: b.headers, rows: b.rows };
  if (b.callout !== undefined) return { callout: b.callout };
  if (b.eg !== undefined) {
    // Encoded as a single "el:Label|Body text" string in the source.
    const pipeIdx = b.eg.indexOf('|');
    const label = (pipeIdx >= 0 ? b.eg.slice(0, pipeIdx) : '').replace(/^el:/, '');
    const text = pipeIdx >= 0 ? b.eg.slice(pipeIdx + 1) : b.eg;
    return { example: { label, text } };
  }
  if (b.sc !== undefined) return { script: { label: b.sc.l, text: b.sc.t, response: b.sc.r || null } };
  if (b.steps !== undefined) {
    return {
      header: b.h || b.header || '',
      steps: b.steps.map(s => ({ num: s.n, title: s.t, body: s.b }))
    };
  }
  return { header: b.h || b.header || '', body: b.body || '', bullets: b.bullets || null };
}

function normalizeQuizQuestion(q) {
  return {
    q: q.q,
    options: q.options || q.opts,
    answer: q.answer !== undefined ? q.answer : q.ans,
    exp: q.exp
  };
}

function normalizeScenario(s) {
  return { prospect: s.prospect || s.p, objection: s.objection || s.o };
}

function normalizeModule(m) {
  return {
    id: m.id,
    title: m.title,
    tag: m.tag || m.sub || '',
    isRoleplay: !!m.isRoleplay,
    content: (m.content || []).map(normalizeBlock),
    quiz: (m.quiz || []).map(normalizeQuizQuestion)
  };
}

// Returns the normalized week, or null if that week number doesn't exist.
function loadWeek(weekNumber, track) {
  if (weekNumber < 1 || weekNumber > totalWeeksFor(track)) return null;
  const raw = loadWeekRaw(weekNumber, track);
  return {
    weekNumber: raw.weekNumber,
    title: raw.title,
    intro: raw.intro,
    certificateDescription: raw.certificateDescription,
    cheatsheet: raw.cheatsheet || null,
    modules: (raw.modules || []).map(normalizeModule),
    scenarios: (raw.scenarios || []).map(normalizeScenario)
  };
}

// Ceilings a 'YYYY-MM-DD' date to the same date if it's already a Monday,
// otherwise the next Monday after it. Pure UTC arithmetic — matches the
// convention used elsewhere in this app for date-only calculations.
function ceilToMonday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const daysUntilMonday = (1 - dow + 7) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date.toISOString().split('T')[0];
}

// Same idea as ceilToMonday, for NowagieOps's Friday-unlock cadence.
function ceilToFriday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const daysUntilFriday = (5 - dow + 7) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilFriday);
  return date.toISOString().split('T')[0];
}

module.exports = { TOTAL_WEEKS, totalWeeksFor, loadWeek, ceilToMonday, ceilToFriday };
