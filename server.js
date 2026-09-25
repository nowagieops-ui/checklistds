require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const db = require('./db/database');
const { sendWhatsApp } = require('./utils/whatsapp');
const { evaluateAttendance } = require('./utils/attendance');
const { lagosParts, today, nowLagos, daysSince, addDaysUTC, formatDate, formatDateShort, formatDateLong, formatTime } = require('./utils/time');
const platformSync = require('./services/platformSync');
const priorityLists = require('./services/priorityLists');
const nowagieLists = require('./services/nowagieLists');
const performance = require('./services/performance');
const trainingWeeks = require('./services/trainingWeeks');
const sheetsSync = require('./services/sheetsSync');
const nowagieSheetsSync = require('./services/nowagieSheetsSync');

// Only used for the telemarketer training academy's AI roleplay feedback.
// Falls back to a canned message if unconfigured, same convention as
// utils/whatsapp.js — never blocks the trainee's flow. Gemini 2.5 Flash is
// cheap/free-tier-eligible, which matters here since this fires on every
// message a trainee sends during roleplay practice.
const geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const FALLBACK_ROLEPLAY_FEEDBACK = 'Good attempt. Acknowledge the concern first, then pivot to the benefit. Always mention the free trial when someone hesitates on cost or complexity.';

const ROLEPLAY_BRIEF = {
  dashspid: `You are a training evaluator for Dashspid, a Nigerian logistics SaaS. A telemarketer is practising objection handling.

KEY DASHSPID FACTS:
- Plans: Free N0/30 orders, Rider N5999/250 orders (bot included), Growth N10799/750 orders, Pro N23999/unlimited
- Transaction fee: 2.5% vs Bolt 20%
- Free trial: 30 days Growth plan, no card
- Dashspid runs ALONGSIDE Bolt, does not replace it
- Instant payout to operator bank account
- Payment via Paystack before rider moves
- Setup 10 minutes
- Shield welfare fund for riders`,
  nowagieops: `You are a training evaluator for NowagieOps, a UK brand growth agency. A telemarketer is practising cold-call objection handling. Her ONLY goal on every call is to book a free, no-obligation strategy call -- nothing is being sold or closed on this call itself.

KEY NOWAGIEOPS FACTS:
- Services: social media management, email marketing, video editing, content creation, website development, app development
- Positioning: "one team, one plan, growth you can measure" instead of juggling multiple freelancers and tools with no strategy
- Engagement types: a la carte, growth partner (full team retainer, most popular), project-based
- The ask is always a free 30-minute strategy call -- no obligation, no card
- Response promised within 1 business day`
};

async function getRoleplayFeedback(scenario, traineeResponse, track) {
  if (!geminiClient) return FALLBACK_ROLEPLAY_FEEDBACK;
  const brief = ROLEPLAY_BRIEF[track] || ROLEPLAY_BRIEF.dashspid;
  try {
    const result = await geminiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${brief}

PROSPECT: ${scenario.prospect}
OBJECTION: "${scenario.objection}"
TRAINEE SAID: "${traineeResponse}"

Give feedback in 2-3 sentences max. One thing done well, one thing to improve, then a sample better response in quotes. Be brief and direct.`
    });
    return result.text || FALLBACK_ROLEPLAY_FEEDBACK;
  } catch (err) {
    console.error('Roleplay feedback error:', err.message);
    return FALLBACK_ROLEPLAY_FEEDBACK;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', true); // behind Cloudflare — needed for accurate req.ip
app.use(express.static(path.join(__dirname, 'public')));

// Bumps on every process start (i.e. every deploy), so /style.css?v=... and
// /favicon.svg?v=... become new URLs the CDN has never cached — no more
// stale styling stuck behind Cloudflare's cache after a push.
app.locals.assetVersion = Date.now();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dashspid-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 }
}));

// A long-lived cookie (separate from the login session) that identifies this
// browser/device across logins — lets us tell whether a check-in is coming
// from a marketer's usual phone or someone else's.
app.use((req, res, next) => {
  let deviceId = req.cookies.device_id;
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    res.cookie('device_id', deviceId, {
      maxAge: 5 * 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax'
    });
  }
  req.deviceId = deviceId;
  next();
});

function clientIp(req) {
  // Cloudflare's header is authoritative and can't be spoofed by the client
  // (Cloudflare overwrites it); req.ip is the fallback for direct/local access.
  return (req.get('CF-Connecting-IP') || req.ip || '').replace('::ffff:', '');
}

// Check-in must never be delayed by a training gate — a module can take a
// while, and making her finish it first would push her attendance timestamp
// past the cutoff and mark an on-time morning as late. She's still fully
// blocked from real work (priority lists, riders, etc.) until she finishes
// the module; only recording that she showed up on time is exempt.
const CHECKIN_PATHS = ['/checklist', '/submit', '/submitted'];

// A marketer assigned to both businesses picks one at login (see
// POST /login and /choose-company) before anything else is gated — this
// page has to stay reachable even though trainingCompleted isn't set yet.
const COMPANY_CHOICE_PATH = '/choose-company';

// The NowagieOps academy launches on this date — not "whenever someone
// first logs in and picks NowagieOps." Before it arrives she can still work
// real NowagieOps leads (the queue/sheet are open — see requireAuth below);
// only the training content itself stays locked until then. Once the date
// has passed this is a no-op forever after, so a telemarketer added to
// NowagieOps later just gets immediate Week 1 access like DashSpid's does.
const NOWAGIE_ACADEMY_START_DATE = '2026-10-02';

async function requireAuth(req, res, next) {
  if (!req.session.marketerId) return res.redirect('/');
  if (req.path === COMPANY_CHOICE_PATH) return next();

  // Which academy/gate applies is decided by which business she picked for
  // this session (defaults to DashSpid for anyone who never sees a choice —
  // field marketers, and telemarketers assigned to only one business).
  const isNowagie = req.session.activeCompany === 'nowagieops';
  const trainingPath = isNowagie ? '/nowagie-training' : '/training';
  const weeklyPath = isNowagie ? '/nowagie-weekly-training' : '/weekly-training';

  // A gate below wants to send her into training — but if she hasn't
  // checked in yet today, send her to check in first instead, so the module
  // (which can take a while) never delays her attendance timestamp past the
  // cutoff. She still can't reach real work either way.
  async function redirectToGate(gatePath) {
    const checkedInToday = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
    return res.redirect(checkedInToday ? gatePath : '/checklist');
  }

  // Telemarketers must finish the training academy before reaching anything
  // else — field marketers are unaffected (trainingCompleted is set true for
  // them at login, see POST /login). /sign-out stays reachable so a trainee
  // isn't stuck with no way to log out mid-training. Exception: before the
  // NowagieOps academy has actually launched, don't block real leads/queue
  // work over training she can't start yet — only /nowagie-training itself
  // shows the "starts <date>" message. This stops being true the moment the
  // launch date arrives, at which point it's the same hard block as always.
  const nowagiePrelaunch = isNowagie && today() < NOWAGIE_ACADEMY_START_DATE;
  if (!nowagiePrelaunch && !req.session.trainingCompleted && !req.path.startsWith(trainingPath) && req.path !== '/sign-out'
      && !CHECKIN_PATHS.includes(req.path)) {
    return redirectToGate(trainingPath);
  }

  // Same hard block for whichever week is currently unlocked — a
  // telemarketer can't reach anything else until she finishes it, exactly
  // like the initial academy. Re-checked once per calendar day (cached on
  // the session) rather than on every request, since this can only change
  // by the next unlock day arriving, not by anything she does mid-day.
  if (req.session.trainingCompleted && req.session.marketerRole === 'telemarketer'
      && !req.path.startsWith(weeklyPath) && !req.path.startsWith(trainingPath) && req.path !== '/sign-out'
      && !CHECKIN_PATHS.includes(req.path)) {
    const checkDate = today();
    if (req.session.weeklyGateCheckedDate !== checkDate) {
      req.session.weeklyGateCheckedDate = checkDate;
      try {
        const state = isNowagie
          ? await getNowagieWeeklyTrainingState(req.session.marketerId)
          : await getWeeklyTrainingState(req.session.marketerId);
        req.session.weeklyGateBlocked = !state.done && !!state.isUnlocked;
      } catch (err) {
        console.error('Weekly training gate check failed:', err.message);
        req.session.weeklyGateBlocked = false; // fail open — never lock her out of real work over an error here
      }
    }
    if (req.session.weeklyGateBlocked) return redirectToGate(weeklyPath);
  }

  next();
}
function requireManagement(req, res, next) {
  if (req.session.isManagement) return next();
  res.redirect('/management-login');
}
// Turns a raw User-Agent string into a short "device · browser" label for
// the dashboard (e.g. "iPhone · Safari") instead of the full unreadable UA
// string. Best-effort pattern matching, not a full UA parser.
function describeDevice(userAgent) {
  if (!userAgent) return null;

  let device = null;
  if (/iPhone/i.test(userAgent)) device = 'iPhone';
  else if (/iPad/i.test(userAgent)) device = 'iPad';
  else if (/Android/i.test(userAgent)) {
    const model = userAgent.match(/Android [\d.]+;\s*([^)]+)\)/);
    device = model ? `Android (${model[1].trim()})` : 'Android';
  } else if (/Windows/i.test(userAgent)) device = 'Windows PC';
  else if (/Macintosh/i.test(userAgent)) device = 'Mac';
  else if (/Linux/i.test(userAgent)) device = 'Linux';

  let browser = null;
  if (/EdgA|Edge/i.test(userAgent)) browser = 'Edge';
  else if (/CriOS|Chrome/i.test(userAgent)) browser = 'Chrome';
  else if (/FxiOS|Firefox/i.test(userAgent)) browser = 'Firefox';
  else if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) browser = 'Safari';

  if (device && browser) return `${device} · ${browser}`;
  return device || browser || 'Unknown device';
}

// Minutes since midnight in Lagos time.
function getLagosMinutesNow() {
  const p = lagosParts();
  return Number(p.hour) * 60 + Number(p.minute);
}
// Checkout only becomes available at 4:30pm Lagos time.
function isAfterCheckoutTime() {
  return getLagosMinutesNow() >= 16 * 60 + 30;
}
// Check-in closes at 12pm Lagos time — no clocking in for the day after that.
function isPastCheckinDeadline() {
  return getLagosMinutesNow() >= 12 * 60;
}

// ── MARKETER ROUTES ──────────────────────────────────────────────────────────

async function publicMarketers() {
  // Never send pin/active to the client — only what the name-search UI needs.
  const marketers = await db.getMarketers();
  return marketers.map(m => ({ id: m.id, name: m.name }));
}

app.get('/', async (req, res) => {
  if (req.session.marketerId) return res.redirect('/home');
  res.render('login', { marketers: await publicMarketers(), error: null });
});

app.post('/login', async (req, res) => {
  const { marketer_id, pin } = req.body;
  const marketer = await db.getMarketer(marketer_id, pin);
  const wantsJson = req.get('X-Requested-With') === 'fetch';

  if (!marketer) {
    if (wantsJson) return res.status(401).json({ ok: false, error: 'Incorrect PIN. Please try again.' });
    return res.render('login', { marketers: await publicMarketers(), error: 'Incorrect PIN. Please try again.' });
  }

  req.session.marketerId = marketer.id;
  req.session.marketerName = marketer.name;
  req.session.marketerRole = marketer.role;

  // A telemarketer assigned to both businesses picks which one she's
  // working today before anything else is decided — everyone else (field
  // marketers, and telemarketers assigned to only one business) skips
  // straight past this and is never shown it.
  if (marketer.role === 'telemarketer' && marketer.works_dashspid && marketer.works_nowagieops) {
    if (wantsJson) return res.json({ ok: true, redirect: COMPANY_CHOICE_PATH });
    return res.redirect(COMPANY_CHOICE_PATH);
  }
  req.session.activeCompany = (marketer.role === 'telemarketer' && marketer.works_nowagieops) ? 'nowagieops' : 'dashspid';
  await enterActiveCompany(req);

  const redirectTo = req.session.trainingCompleted ? '/home' : '/training';
  if (wantsJson) return res.json({ ok: true, redirect: redirectTo });
  res.redirect(redirectTo);
});

// Sets trainingCompleted (and resets the weekly-gate cache) for whichever
// company is now active — called right after activeCompany is decided,
// either automatically at login or from the company-choice screen below.
async function enterActiveCompany(req) {
  if (req.session.marketerRole !== 'telemarketer') {
    req.session.trainingCompleted = true; // gate only applies to telemarketers
  } else if (req.session.activeCompany === 'nowagieops') {
    const progress = await db.getNowagieTrainingProgress(req.session.marketerId);
    req.session.trainingCompleted = !!(progress && progress.completed_at);
  } else {
    const progress = await db.getTrainingProgress(req.session.marketerId);
    req.session.trainingCompleted = !!(progress && progress.completed_at);
  }
  req.session.weeklyGateCheckedDate = null;
  req.session.weeklyGateBlocked = false;
}

app.get(COMPANY_CHOICE_PATH, requireAuth, (req, res) => {
  res.render('choose-company', { name: req.session.marketerName });
});

app.post(COMPANY_CHOICE_PATH, requireAuth, async (req, res) => {
  const { company } = req.body;
  if (!['dashspid', 'nowagieops'].includes(company)) return res.redirect(COMPANY_CHOICE_PATH);
  req.session.activeCompany = company;
  await enterActiveCompany(req);
  const trainingPath = company === 'nowagieops' ? '/nowagie-training' : '/training';
  res.redirect(req.session.trainingCompleted ? '/home' : trainingPath);
});

// A day counts green only once BOTH a login and a logout event exist for it
// AND the login happened before the cutoff — a late-but-complete day shows
// amber instead, not green. Today is never marked missed — it's still
// "pending" until it becomes a past day, at which point an incomplete day
// naturally falls into "missed" since this is recomputed fresh from
// today()'s date on every page load. Weekends aren't workdays, so an empty
// Saturday/Sunday doesn't count against them — unless they actually worked
// it, in which case it still shows complete/late like any other day.
function buildAttendanceCalendar(events, fromDateStr, toDateStr, cutoff) {
  const byDate = {};
  events.forEach(e => {
    const d = e.timestamp.slice(0, 10);
    if (!byDate[d]) byDate[d] = { login: false, logout: false, loginTime: null };
    if (e.type === 'login') {
      byDate[d].login = true;
      byDate[d].loginTime = e.timestamp.slice(11, 16);
    }
    if (e.type === 'logout') byDate[d].logout = true;
  });

  const calendar = [];
  let dateStr = fromDateStr;
  while (dateStr <= toDateStr) {
    const rec = byDate[dateStr];
    const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    let status;
    if (rec && rec.login && rec.logout) status = rec.loginTime > cutoff ? 'late' : 'complete';
    else if (isWeekend) status = 'weekend';
    else if (dateStr === toDateStr) status = 'pending';
    else status = 'missed';

    calendar.push({ date: dateStr, label: parseInt(dateStr.split('-')[2], 10), status });
    dateStr = addDaysUTC(dateStr, 1);
  }
  return calendar.reverse(); // today first, counting backward
}

app.get('/home', requireAuth, async (req, res) => {
  const marketer = await db.getMarketerById(req.session.marketerId);
  const role = marketer ? marketer.role : 'field_marketer';
  const nowagie = req.session.activeCompany === 'nowagieops';
  const queueHref = nowagie ? '/nowagie-queue' : '/priority-lists';
  const addLeadHref = nowagie ? '/nowagie-leads/new' : '/prospects/new';
  const queueHeading = nowagie ? "Today's Call Queue" : (role === 'telemarketer' ? "Today's Call Queue" : 'My Priority Lists');
  const openProspects = nowagie
    ? (await nowagieLists.getAllListCounts()).reduce((sum, l) => sum + l.count, 0)
    : (await priorityLists.getAllListCounts(scopeMarketerId(marketer))).reduce((sum, l) => sum + l.count, 0);

  const submittedToday = !!(await db.getSubmissionByMarketerToday(req.session.marketerId, today()));

  const toDate = today();
  const maxLookback = addDaysUTC(toDate, -13); // never show more than 14 days
  const earliestDate = await db.getEarliestAttendanceDate(req.session.marketerId);
  // A marketer with no attendance history yet just sees today — no
  // fabricated "missed" days from before they actually started checking in.
  const fromDate = !earliestDate ? toDate : (earliestDate > maxLookback ? earliestDate : maxLookback);

  const events = await db.getAttendanceForMarketerInRange(req.session.marketerId, fromDate, toDate);
  const cutoff = process.env.CHECKIN_CUTOFF || '09:00';
  const attendanceCalendar = buildAttendanceCalendar(events, fromDate, toDate, cutoff);
  const canCheckin = !submittedToday && !isPastCheckinDeadline();
  const missedCheckin = !submittedToday && isPastCheckinDeadline();
  const canCheckout = submittedToday && isAfterCheckoutTime();

  // Ongoing weekly training program (weeks 2-12) — field marketers never see
  // this, and it's just a status line, not a gate, so a failure here should
  // never break the home screen.
  let weeklyTraining = null;
  if (role === 'telemarketer' && req.session.activeCompany === 'nowagieops' && !req.session.trainingCompleted) {
    // Only reachable during the NowagieOps prelaunch window (requireAuth
    // lets her through to /home without training done) — Week 1 itself
    // isn't unlocked yet, so there's no weekly state to compute at all.
    weeklyTraining = { prelaunch: true, unlockDateFormatted: formatDateLong(NOWAGIE_ACADEMY_START_DATE), href: '/nowagie-training' };
  } else if (role === 'telemarketer') {
    const nowagie = req.session.activeCompany === 'nowagieops';
    const href = nowagie ? '/nowagie-weekly-training' : '/weekly-training';
    const totalWeeks = trainingWeeks.totalWeeksFor(nowagie ? 'nowagieops' : 'dashspid');
    try {
      const state = nowagie ? await getNowagieWeeklyTrainingState(req.session.marketerId) : await getWeeklyTrainingState(req.session.marketerId);
      if (state.done) {
        weeklyTraining = { done: true, href, totalWeeks };
      } else {
        const weekTitle = trainingWeeks.loadWeek(state.nextWeek, nowagie ? 'nowagieops' : 'dashspid').title;
        weeklyTraining = state.isUnlocked
          ? { available: true, weekNumber: state.nextWeek, title: weekTitle, href }
          : { available: false, weekNumber: state.nextWeek, title: weekTitle, unlockDateFormatted: formatDateShort(state.unlockDate), href };
      }
    } catch (err) {
      console.error('Weekly training status error:', err.message);
    }
  }

  res.render('home', { name: req.session.marketerName, role, openProspects, queueHref, queueHeading, addLeadHref, submittedToday, canCheckin, missedCheckin, canCheckout, date: formatDate(), attendanceCalendar, weeklyTraining });
});

// Plain sign-out for "wrong person is logged in on this device" — ends the
// session immediately with no location/summary questions. The full
// end-of-day checkout (which does ask those) lives at GET/POST /logout.
app.get('/sign-out', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/checklist', requireAuth, async (req, res) => {
  const existing = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
  if (existing) return res.redirect('/submitted');
  const view = req.session.marketerRole === 'telemarketer' ? 'checklist-telemarketer' : 'checklist';
  res.render(view, { name: req.session.marketerName, date: formatDate() });
});

app.post('/submit', requireAuth, async (req, res) => {
  const existing = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
  if (existing) return res.redirect('/submitted');

  const { zone, targets, notes, lat, lng, accuracy } = req.body;

  if (lat === undefined || lng === undefined || lat === '' || lng === '') {
    return res.status(400).send('Location access is required to submit your checklist. Please enable location and try again.');
  }

  if (req.session.marketerRole === 'telemarketer' && (parseInt(targets, 10) || 0) < 25) {
    return res.status(400).send('Call target must be at least 25.');
  }

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const ip = clientIp(req);
  const owner = await db.getDeviceOwner(req.deviceId);
  const marketerId = req.session.marketerId;
  const marketerName = req.session.marketerName;

  const result = await evaluateAttendance({
    marketerId,
    deviceOwnerId: owner ? owner.id : null,
    deviceOwnerName: owner ? owner.name : null,
    lat: parsedLat, lng: parsedLng, ip
  });

  await db.registerDevice(marketerId, req.deviceId);
  await db.addAttendance({
    marketer_id: marketerId,
    marketer_name: marketerName,
    type: 'login',
    lat: parsedLat,
    lng: parsedLng,
    accuracy: accuracy ? parseFloat(accuracy) : null,
    ip,
    device_id: req.deviceId,
    user_agent: req.get('User-Agent') || '',
    flagged: result.flagged,
    flags: result.flags,
    address: result.address,
    timestamp: nowLagos()
  });

  const checklistItems = Object.keys(req.body).filter(k => k.startsWith('item_'));

  const sub = await db.addSubmission({
    marketer_id: marketerId,
    marketer_name: marketerName,
    date: today(),
    zone: zone || '',
    targets: targets || '',
    checklist_items: checklistItems,
    notes: notes || '',
    submitted_at: nowLagos()
  });

  const time = formatTime(sub.submitted_at);
  const cutoff = process.env.CHECKIN_CUTOFF || '09:00';
  const isLate = time > cutoff;
  const status = isLate ? 'LATE' : 'ON TIME';

  sendWhatsApp(
    `${status} — ${req.session.marketerName} checked in at ${time}\nZone: ${zone || 'Not set'}\nTargets: ${targets || 'Not set'}`
  );

  res.redirect('/submitted');
});

app.get('/submitted', requireAuth, async (req, res) => {
  const sub = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
  res.render('submitted', {
    name: req.session.marketerName,
    role: req.session.marketerRole,
    submission: sub,
    time: sub ? formatTime(sub.submitted_at) : null
  });
});

// ── TELEMARKETER TRAINING ACADEMY (WEEK 1 GATE + WEEKLY PROGRAM) ─────────────

app.get('/training', requireAuth, async (req, res) => {
  if (req.session.trainingCompleted) return res.redirect('/home');
  const progress = await db.getTrainingProgress(req.session.marketerId);
  res.render('training', {
    name: req.session.marketerName,
    weekData: trainingWeeks.loadWeek(1),
    weekMode: 'gate',
    initialCompleted: progress ? progress.completed_modules : {}
  });
});

// Figures out which week (2-12) a telemarketer should be working on right
// now: the week after their last completed one, but only once BOTH that
// prior week is done AND the next Monday has arrived — never both at once,
// and never skipping ahead just because time passed on an unfinished week.
async function getWeeklyTrainingState(marketerId) {
  const week1Progress = await db.getTrainingProgress(marketerId);
  const week1CompletedAt = week1Progress ? week1Progress.completed_at : null;
  if (!week1CompletedAt) return { locked: true, nextWeek: 2, unlockDate: null, isUnlocked: false };

  const weekRows = await db.getAllWeekProgress(marketerId);
  const byWeek = {};
  weekRows.forEach(r => { byWeek[r.week_number] = r; });

  let lastCompletedWeek = 1;
  let lastCompletedDate = week1CompletedAt.slice(0, 10);
  for (let w = 2; w <= trainingWeeks.TOTAL_WEEKS; w++) {
    const row = byWeek[w];
    if (row && row.completed_at) {
      lastCompletedWeek = w;
      lastCompletedDate = row.completed_at.slice(0, 10);
    } else {
      break;
    }
  }

  const nextWeek = lastCompletedWeek + 1;
  if (nextWeek > trainingWeeks.TOTAL_WEEKS) return { done: true, lastCompletedWeek };

  const unlockDate = trainingWeeks.ceilToMonday(lastCompletedDate);
  const nextWeekRow = byWeek[nextWeek] || null;

  return {
    done: false,
    nextWeek,
    unlockDate,
    isUnlocked: today() >= unlockDate,
    initialCompleted: nextWeekRow ? nextWeekRow.completed_modules : {}
  };
}

app.get('/weekly-training', requireAuth, async (req, res) => {
  if (req.session.marketerRole !== 'telemarketer') return res.redirect('/home');

  const state = await getWeeklyTrainingState(req.session.marketerId);

  if (state.done) {
    return res.render('weekly-training-locked', { name: req.session.marketerName, done: true, totalWeeks: trainingWeeks.totalWeeksFor('dashspid') });
  }
  if (!state.isUnlocked) {
    const nextWeekData = trainingWeeks.loadWeek(state.nextWeek);
    return res.render('weekly-training-locked', {
      name: req.session.marketerName,
      done: false,
      nextWeekNumber: state.nextWeek,
      nextWeekTitle: nextWeekData.title,
      unlockDateFormatted: formatDateLong(state.unlockDate)
    });
  }

  res.render('training', {
    name: req.session.marketerName,
    weekData: trainingWeeks.loadWeek(state.nextWeek),
    weekMode: 'weekly',
    initialCompleted: state.initialCompleted || {}
  });
});

// ── NOWAGIEOPS TRAINING ACADEMY (mirrors the two routes/function above) ──────

app.get('/nowagie-training', requireAuth, async (req, res) => {
  if (req.session.trainingCompleted) return res.redirect('/home');
  if (today() < NOWAGIE_ACADEMY_START_DATE) {
    return res.render('weekly-training-locked', {
      name: req.session.marketerName,
      done: false,
      nextWeekNumber: 1,
      nextWeekTitle: trainingWeeks.loadWeek(1, 'nowagieops').title,
      unlockDateFormatted: formatDateLong(NOWAGIE_ACADEMY_START_DATE)
    });
  }
  const progress = await db.getNowagieTrainingProgress(req.session.marketerId);
  res.render('training', {
    name: req.session.marketerName,
    weekData: trainingWeeks.loadWeek(1, 'nowagieops'),
    weekMode: 'gate',
    initialCompleted: progress ? progress.completed_modules : {}
  });
});

async function getNowagieWeeklyTrainingState(marketerId) {
  const week1Progress = await db.getNowagieTrainingProgress(marketerId);
  const week1CompletedAt = week1Progress ? week1Progress.completed_at : null;
  if (!week1CompletedAt) return { locked: true, nextWeek: 2, unlockDate: null, isUnlocked: false };

  const weekRows = await db.getAllNowagieWeekProgress(marketerId);
  const byWeek = {};
  weekRows.forEach(r => { byWeek[r.week_number] = r; });

  const totalWeeks = trainingWeeks.totalWeeksFor('nowagieops');
  let lastCompletedWeek = 1;
  let lastCompletedDate = week1CompletedAt.slice(0, 10);
  for (let w = 2; w <= totalWeeks; w++) {
    const row = byWeek[w];
    if (row && row.completed_at) {
      lastCompletedWeek = w;
      lastCompletedDate = row.completed_at.slice(0, 10);
    } else {
      break;
    }
  }

  const nextWeek = lastCompletedWeek + 1;
  if (nextWeek > totalWeeks) return { done: true, lastCompletedWeek };

  const unlockDate = trainingWeeks.ceilToFriday(lastCompletedDate);
  const nextWeekRow = byWeek[nextWeek] || null;

  return {
    done: false,
    nextWeek,
    unlockDate,
    isUnlocked: today() >= unlockDate,
    initialCompleted: nextWeekRow ? nextWeekRow.completed_modules : {}
  };
}

app.get('/nowagie-weekly-training', requireAuth, async (req, res) => {
  if (req.session.marketerRole !== 'telemarketer') return res.redirect('/home');

  const state = await getNowagieWeeklyTrainingState(req.session.marketerId);

  if (state.done) {
    return res.render('weekly-training-locked', { name: req.session.marketerName, done: true, totalWeeks: trainingWeeks.totalWeeksFor('nowagieops') });
  }
  if (!state.isUnlocked) {
    const nextWeekData = trainingWeeks.loadWeek(state.nextWeek, 'nowagieops');
    return res.render('weekly-training-locked', {
      name: req.session.marketerName,
      done: false,
      nextWeekNumber: state.nextWeek,
      nextWeekTitle: nextWeekData.title,
      unlockDateFormatted: formatDateLong(state.unlockDate)
    });
  }

  res.render('training', {
    name: req.session.marketerName,
    weekData: trainingWeeks.loadWeek(state.nextWeek, 'nowagieops'),
    weekMode: 'weekly',
    initialCompleted: state.initialCompleted || {}
  });
});

// The three routes below are shared by both academies — which company's
// tables they read/write is decided by req.session.activeCompany, already
// known server-side, so the training.ejs client code needs no changes at
// all to work for either track.
app.post('/training/progress', requireAuth, async (req, res) => {
  const { completedModules, week } = req.body;
  const weekNumber = week || 1;
  const nowagie = req.session.activeCompany === 'nowagieops';
  if (weekNumber === 1) {
    const existing = nowagie ? await db.getNowagieTrainingProgress(req.session.marketerId) : await db.getTrainingProgress(req.session.marketerId);
    const upsert = nowagie ? db.upsertNowagieTrainingProgress : db.upsertTrainingProgress;
    await upsert(req.session.marketerId, completedModules, existing ? existing.roleplay_log : [], nowLagos());
  } else {
    const existing = nowagie ? await db.getNowagieWeekProgress(req.session.marketerId, weekNumber) : await db.getWeekProgress(req.session.marketerId, weekNumber);
    const upsert = nowagie ? db.upsertNowagieWeekProgress : db.upsertWeekProgress;
    await upsert(req.session.marketerId, weekNumber, completedModules, existing ? existing.roleplay_log : [], nowLagos());
  }
  res.json({ ok: true });
});

app.post('/training/roleplay-feedback', requireAuth, async (req, res) => {
  const { scenario, response: traineeResponse, week } = req.body;
  if (!scenario || !traineeResponse) return res.status(400).json({ ok: false, error: 'Missing scenario or response.' });
  const weekNumber = week || 1;
  const nowagie = req.session.activeCompany === 'nowagieops';

  const feedback = await getRoleplayFeedback(scenario, traineeResponse, nowagie ? 'nowagieops' : 'dashspid');

  if (weekNumber === 1) {
    const existing = nowagie ? await db.getNowagieTrainingProgress(req.session.marketerId) : await db.getTrainingProgress(req.session.marketerId);
    const roleplayLog = existing && existing.roleplay_log ? existing.roleplay_log : [];
    roleplayLog.push({ scenario, response: traineeResponse, feedback, at: nowLagos() });
    const upsert = nowagie ? db.upsertNowagieTrainingProgress : db.upsertTrainingProgress;
    await upsert(req.session.marketerId, existing ? existing.completed_modules : {}, roleplayLog, nowLagos());
  } else {
    const existing = nowagie ? await db.getNowagieWeekProgress(req.session.marketerId, weekNumber) : await db.getWeekProgress(req.session.marketerId, weekNumber);
    const roleplayLog = existing && existing.roleplay_log ? existing.roleplay_log : [];
    roleplayLog.push({ scenario, response: traineeResponse, feedback, at: nowLagos() });
    const upsert = nowagie ? db.upsertNowagieWeekProgress : db.upsertWeekProgress;
    await upsert(req.session.marketerId, weekNumber, existing ? existing.completed_modules : {}, roleplayLog, nowLagos());
  }

  res.json({ ok: true, feedback });
});

app.post('/training/complete', requireAuth, async (req, res) => {
  const { week } = req.body;
  const weekNumber = week || 1;
  const nowagie = req.session.activeCompany === 'nowagieops';
  if (weekNumber === 1) {
    await (nowagie ? db.completeNowagieTraining(req.session.marketerId, nowLagos()) : db.completeTraining(req.session.marketerId, nowLagos()));
    req.session.trainingCompleted = true;
    return res.json({ ok: true, redirect: '/home' });
  }
  await (nowagie ? db.completeNowagieWeekProgress(req.session.marketerId, weekNumber, nowLagos()) : db.completeWeekProgress(req.session.marketerId, weekNumber, nowLagos()));
  req.session.weeklyGateBlocked = false; // she just cleared it — don't wait for tomorrow's re-check to let her back in
  res.json({ ok: true, redirect: '/home' });
});

// ── RIDER ONBOARDING ROUTES ──────────────────────────────────────────────────

app.get('/riders/new', requireAuth, (req, res) => {
  res.render('rider-new', { name: req.session.marketerName, error: null });
});

app.post('/riders', requireAuth, async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email || !phone) {
    return res.render('rider-new', { name: req.session.marketerName, error: 'Please fill in the rider\'s name, email, and phone number.' });
  }

  const marketerId = req.session.marketerId;

  // Same device-ownership check used for attendance — flags (never blocks)
  // when the phone that logged this rider was last tied to a different
  // marketer, which is exactly the "same phone, different account" signal.
  const owner = await db.getDeviceOwner(req.deviceId);
  const deviceFlagged = !!(owner && owner.id !== marketerId);
  const deviceFlagReason = deviceFlagged ? `This device was last used to check in as ${owner.name}` : null;
  await db.registerDevice(marketerId, req.deviceId);

  // Channel attribution follows the staff member's own role — a telemarketer
  // onboarding a prospect over the phone counts as the telemarketer channel,
  // not field, for the growth-OS priority lists and dashboard rollups.
  const marketer = await db.getMarketerById(marketerId);
  const channel = marketer && marketer.role === 'telemarketer' ? 'telemarketer' : 'field_marketer';

  const rider = await db.addRider({
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    added_by_marketer_id: marketerId,
    added_by_marketer_name: req.session.marketerName,
    device_id: req.deviceId,
    user_agent: req.get('User-Agent') || '',
    device_flagged: deviceFlagged,
    device_flag_reason: deviceFlagReason,
    channel
  }, nowLagos());

  res.redirect(`/riders/${rider.id}/checklist`);
});

app.get('/riders/:id/checklist', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  if (!rider || rider.added_by_marketer_id !== req.session.marketerId) return res.redirect('/home');
  if (rider.completed) return res.redirect(`/riders/${rider.id}/done`);
  res.render('rider-checklist', { rider });
});

app.post('/riders/:id/checklist', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  if (!rider || rider.added_by_marketer_id !== req.session.marketerId) return res.redirect('/home');

  const checklistItems = Object.keys(req.body).filter(k => k.startsWith('item_'));
  await db.completeRiderChecklist(rider.id, checklistItems, req.body.notes, nowLagos());
  res.redirect(`/riders/${rider.id}/done`);
});

app.get('/riders/:id/done', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  if (!rider || rider.added_by_marketer_id !== req.session.marketerId) return res.redirect('/home');
  res.render('rider-done', { rider, time: rider.completed_at ? formatTime(rider.completed_at) : null });
});

// ── QUICK-ADD LEAD (no checklist) ────────────────────────────────────────────
// For a telemarketer (or a field marketer) to log a brand-new warm prospect
// they're about to work, without the in-person onboarding checklist — that
// stays specific to "Onboard New Rider" (device-flag checks, QC checklist,
// the whole flow), which doesn't make sense for someone reached by phone.

app.get('/prospects/new', requireAuth, async (req, res) => {
  const reasonCodes = await db.getReasonCodes();
  res.render('prospect-new', { error: null, reasonCodes });
});

app.post('/prospects', requireAuth, async (req, res) => {
  const { name, phone, reason_code, notes } = req.body;
  if (!name || !name.trim() || !phone || !phone.trim()) {
    const reasonCodes = await db.getReasonCodes();
    return res.render('prospect-new', { error: "Enter the lead's name and phone number.", reasonCodes });
  }

  const marketerId = req.session.marketerId;
  const marketer = await db.getMarketerById(marketerId);
  const channel = marketer && marketer.role === 'telemarketer' ? 'telemarketer' : 'field_marketer';

  const rider = await db.addRider({
    name: name.trim(),
    email: '',
    phone: phone.trim(),
    added_by_marketer_id: marketerId,
    added_by_marketer_name: req.session.marketerName,
    channel
  }, nowLagos());

  // Logging a new lead IS the day's first contact with them — telemarketer
  // called, field marketer visited. No separate "Called" tap needed right
  // after adding someone. Why they haven't onboarded yet (if anything) goes
  // on this same contact record, same reason-code system the follow-up form
  // already uses — not a separate one-off notes field on the rider itself.
  await db.addFollowup({
    rider_id: rider.id,
    staff_id: marketerId,
    type: channel === 'telemarketer' ? 'call' : 'visit',
    stage_before: 'new',
    stage_after: 'new',
    reason_code: reason_code || null,
    desired_action: null,
    action_completed: false,
    link_shared_confirmed: false,
    notes: notes && notes.trim() ? notes.trim() : null,
    next_followup_date: null,
    created_at: nowLagos()
  });

  res.redirect(`/riders/${rider.id}`);
});

// ── CORE PRIORITY LISTS (P1-P6) ──────────────────────────────────────────────
// Shared by field marketer and telemarketer alike — same underlying queries
// (services/priorityLists.js). The view adapts its own copy/labels by role.
//
// Scope differs by role, and deliberately so: a field marketer works the
// specific people they sourced face-to-face, but the telemarketer's job is
// working the whole company-wide funnel by phone regardless of which
// channel originally registered someone — ownership of who onboarded a
// prospect doesn't change whose job it is to call them forward. This only
// stays correct with exactly one telemarketer; with more than one, "sees
// everyone" needs a real assignment mechanism instead.
function scopeMarketerId(marketer) {
  return marketer && marketer.role === 'telemarketer' ? null : (marketer ? marketer.id : null);
}

// A prospect can be acted on by whoever sourced them, OR by the
// telemarketer (who can act on anyone, per the scope rule above).
function canAccessRider(rider, marketer) {
  if (!rider || !marketer) return false;
  return rider.added_by_marketer_id === marketer.id || marketer.role === 'telemarketer';
}

// Only a same-origin path is ever accepted for a query-string redirect
// target — rejects absolute URLs and protocol-relative ones (e.g.
// "//evil.com", which starts with "/" but is an open redirect).
function isSafeLocalRedirect(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

app.get('/priority-lists', requireAuth, async (req, res) => {
  const marketer = await db.getMarketerById(req.session.marketerId);
  const role = marketer ? marketer.role : 'field_marketer';
  const scopeId = scopeMarketerId(marketer);

  const counts = await priorityLists.getAllListCounts(scopeId);
  const activeList = priorityLists.LISTS[req.query.list] ? req.query.list : 'P1';
  const meta = priorityLists.LISTS[activeList];

  const contactedTodayIds = new Set(await db.getContactedTodayRiderIds(req.session.marketerId, today()));
  const rawRows = await priorityLists.getListRows(activeList, scopeId);
  const rows = rawRows.map(r => ({
    ...r,
    daysInStage: daysSince(r[meta.orderByColumn] || r.created_at),
    contactedToday: contactedTodayIds.has(r.id)
  }));

  const callSummary = await performance.getTodayCallSummary(req.session.marketerId, today());

  res.render('priority-lists', {
    heading: role === 'telemarketer' ? "Today's Call Queue" : 'My Priority Lists',
    baseUrl: '/priority-lists',
    riderBaseUrl: '/riders',
    backHref: '/home',
    backLabel: '← Back to Home',
    viewerIsManagement: false,
    callSummary,
    counts,
    activeList,
    activeMeta: priorityLists.listMeta(activeList),
    rows
  });
});

// Management's read-only drill-down into one staff member's own priority
// lists — same queries, same template, just a different base URL/back link
// and no self-service "My Performance" shortcut.
app.get('/management/staff/:id/priority-lists', requireManagement, async (req, res) => {
  const staff = await db.getMarketerById(req.params.id);
  if (!staff) return res.redirect('/management/staff-performance');

  const scopeId = scopeMarketerId(staff);
  const counts = await priorityLists.getAllListCounts(scopeId);
  const activeList = priorityLists.LISTS[req.query.list] ? req.query.list : 'P1';
  const meta = priorityLists.LISTS[activeList];

  const rawRows = await priorityLists.getListRows(activeList, scopeId);
  const rows = rawRows.map(r => ({ ...r, daysInStage: daysSince(r[meta.orderByColumn] || r.created_at) }));
  const callSummary = await performance.getTodayCallSummary(staff.id, today());

  res.render('priority-lists', {
    heading: `${staff.name}'s Priority Lists`,
    baseUrl: `/management/staff/${staff.id}/priority-lists`,
    riderBaseUrl: '/management/riders',
    backHref: '/management/staff-performance',
    backLabel: '← Back to Staff Performance',
    viewerIsManagement: true,
    callSummary,
    counts,
    activeList,
    activeMeta: priorityLists.listMeta(activeList),
    rows
  });
});

const FUNNEL_STAGE_LABELS = {
  new: 'New',
  registered: 'Registered',
  activated: 'Activated',
  link_shared: 'Link Shared',
  customer_activity: 'Customer Activity',
  first_order: 'First Order',
  completed_order: 'Completed Order'
};

// Every stage timestamp worth showing on the prospect detail screen, in
// funnel order — only the ones actually set get rendered.
const FUNNEL_TIMELINE_FIELDS = [
  { key: 'registered_at', label: 'Registered' },
  { key: 'activated_at', label: 'Activated' },
  { key: 'link_shared_at', label: 'Link Shared' },
  { key: 'first_activity_at', label: 'First Customer Activity' },
  { key: 'first_order_at', label: 'First Order' },
  { key: 'completed_order_at', label: 'Completed Order' },
  { key: 'repeat_business_order_at', label: 'Repeat Order (Business)' },
  { key: 'first_repeat_customer_at', label: 'First Repeat Customer' }
];

app.get('/my-performance', requireAuth, async (req, res) => {
  const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
  const toDate = today();
  const fromDate = period === 'today' ? toDate : period === 'week' ? addDaysUTC(toDate, -6) : addDaysUTC(toDate, -29);

  const scorecard = await performance.getStaffScorecard(req.session.marketerId, fromDate, toDate);
  const recentRegistrations = (await performance.getRecentRegistrations(req.session.marketerId)).map(r => ({
    ...r,
    dateFormatted: formatDateShort(r.registered_at.slice(0, 10))
  }));
  res.render('my-performance', { name: req.session.marketerName, period, scorecard, recentRegistrations });
});

// Live daily app-usage rows (opens/active minutes) for the prospect detail
// screen — fetched fresh from Supabase each view, not synced into MySQL
// (see platformSync.getRecentUsage). Sparse: a day with zero activity
// simply doesn't appear, never shown as a fabricated 0.
async function getUsageDays(rider) {
  if (!rider.platform_business_id) return [];
  const rows = await platformSync.getRecentUsage(rider.platform_business_id, 7);
  return rows.map(r => ({
    dateFormatted: formatDateShort(r.day),
    opens: r.open_count || 0,
    minutes: Math.round((r.active_seconds || 0) / 60)
  }));
}

// Full roster — "everyone I've ever worked," not just who currently needs
// action. Scoped the same way as the priority lists (own leads for a field
// marketer, everyone for the telemarketer — see scopeMarketerId above).
app.get('/prospects', requireAuth, async (req, res) => {
  const marketer = await db.getMarketerById(req.session.marketerId);
  const rows = await priorityLists.getAllProspects(scopeMarketerId(marketer));

  const prospects = rows.map(r => ({
    ...r,
    stageLabel: FUNNEL_STAGE_LABELS[r.funnel_stage] || r.funnel_stage,
    dateAdded: formatDateShort(r.created_at.slice(0, 10))
  }));

  const summary = {
    total: rows.length,
    registered: rows.filter(r => r.registered_at).length,
    activated: rows.filter(r => r.activated_at).length,
    linkShared: rows.filter(r => r.link_shared_at).length,
    customerActivity: rows.filter(r => r.first_activity_at).length,
    firstOrder: rows.filter(r => r.first_order_at).length,
    completedOrder: rows.filter(r => r.completed_order_at).length,
    repeatOrder: rows.filter(r => r.repeat_business_order_at).length
  };

  res.render('prospects-roster', { prospects, summary });
});

app.get('/riders/:id', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  const marketer = await db.getMarketerById(req.session.marketerId);
  if (!canAccessRider(rider, marketer)) return res.redirect('/priority-lists');

  const followups = (await db.getFollowupsForRider(rider.id)).map(f => ({
    ...f,
    stageBeforeLabel: FUNNEL_STAGE_LABELS[f.stage_before] || f.stage_before,
    stageAfterLabel: FUNNEL_STAGE_LABELS[f.stage_after] || f.stage_after,
    dateFormatted: formatDateShort(f.created_at.slice(0, 10)),
    timeFormatted: formatTime(f.created_at)
  }));
  const reasonCodes = await db.getReasonCodes();

  const timeline = FUNNEL_TIMELINE_FIELDS
    .filter(f => rider[f.key])
    .map(f => ({ label: f.label, dateFormatted: formatDateShort(rider[f.key].slice(0, 10)), timeFormatted: formatTime(rider[f.key]) }));

  const usageDays = await getUsageDays(rider);
  const linkCandidates = (!rider.platform_business_id)
    ? await platformSync.getUnmatchedCandidatesForStaff(marketer.name)
    : [];

  res.render('rider-detail', {
    rider,
    stageLabel: FUNNEL_STAGE_LABELS[rider.funnel_stage] || rider.funnel_stage,
    timeline,
    usageDays,
    linkCandidates,
    followups,
    reasonCodes,
    today: today(),
    viewerIsManagement: false,
    backHref: '/priority-lists',
    backLabel: '← Back to Priority Lists'
  });
});

// Manual override for the ambiguous case: staff confirms a specific
// "new"-stage prospect is the same person as a specific recent platform
// signup, rather than waiting on (or second-guessing) the automatic
// oldest-unmatched-prospect heuristic in platformSync.js.
app.post('/riders/:id/link-business', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  const marketer = await db.getMarketerById(req.session.marketerId);
  if (!canAccessRider(rider, marketer)) return res.redirect('/priority-lists');

  if (req.body.platform_business_id && !rider.platform_business_id) {
    await db.linkRiderToPlatformBusiness(rider.id, req.body.platform_business_id, nowLagos());
  }
  res.redirect(`/riders/${rider.id}`);
});

// Management's read-only view of any prospect — same funnel timeline and
// follow-up history as the staff-facing screen, but no follow-up form (a
// follow-up should be attributed to whoever actually did it, not whoever's
// viewing it) and shows who sourced the prospect.
app.get('/management/riders/:id', requireManagement, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  if (!rider) return res.redirect('/management/staff-performance');

  const followups = (await db.getFollowupsForRider(rider.id)).map(f => ({
    ...f,
    stageBeforeLabel: FUNNEL_STAGE_LABELS[f.stage_before] || f.stage_before,
    stageAfterLabel: FUNNEL_STAGE_LABELS[f.stage_after] || f.stage_after,
    dateFormatted: formatDateShort(f.created_at.slice(0, 10)),
    timeFormatted: formatTime(f.created_at)
  }));

  const timeline = FUNNEL_TIMELINE_FIELDS
    .filter(f => rider[f.key])
    .map(f => ({ label: f.label, dateFormatted: formatDateShort(rider[f.key].slice(0, 10)), timeFormatted: formatTime(rider[f.key]) }));

  const usageDays = await getUsageDays(rider);

  res.render('rider-detail', {
    rider,
    stageLabel: FUNNEL_STAGE_LABELS[rider.funnel_stage] || rider.funnel_stage,
    timeline,
    usageDays,
    linkCandidates: [],
    followups,
    reasonCodes: [],
    today: today(),
    viewerIsManagement: true,
    backHref: `/management/staff/${rider.added_by_marketer_id}/priority-lists`,
    backLabel: '← Back to Priority Lists'
  });
});

app.post('/riders/:id/followups', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  const marketer = await db.getMarketerById(req.session.marketerId);
  if (!canAccessRider(rider, marketer)) return res.redirect('/priority-lists');

  const { type, reason_code, desired_action, action_completed, link_shared_confirmed, notes, next_followup_date } = req.body;
  const stageBefore = rider.funnel_stage;

  if (link_shared_confirmed) {
    await db.confirmLinkShared(rider.id, nowLagos());
  }

  const updatedRider = await db.getRider(rider.id);

  await db.addFollowup({
    rider_id: rider.id,
    staff_id: req.session.marketerId,
    type: type === 'visit' ? 'visit' : 'call',
    stage_before: stageBefore,
    stage_after: updatedRider.funnel_stage,
    reason_code: reason_code || null,
    desired_action: desired_action || null,
    action_completed: !!action_completed,
    link_shared_confirmed: !!link_shared_confirmed,
    notes: notes || null,
    next_followup_date: next_followup_date || null,
    created_at: nowLagos()
  });

  res.redirect(`/riders/${rider.id}`);
});

// One-tap "I called/visited this person today" — a bare-bones followups row
// with no stage change, for when there's genuinely nothing more to record
// than the contact itself. Deliberately the same table as the full
// follow-up form (not a separate counter), so "200 calls logged, 3 moved a
// stage" stays computable from one source of truth rather than two.
app.post('/riders/:id/quick-call', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  const marketer = await db.getMarketerById(req.session.marketerId);
  if (!canAccessRider(rider, marketer)) return res.redirect('/priority-lists');

  // Caps at one contact per prospect per day — the whole point of a
  // one-tap button is "I touched this today," not a raw click counter. A
  // second tap the same day is a no-op, not a second logged contact.
  const alreadyContacted = await db.hasContactedToday(req.session.marketerId, rider.id, today());
  if (!alreadyContacted) {
    await db.addFollowup({
      rider_id: rider.id,
      staff_id: req.session.marketerId,
      type: 'call',
      stage_before: rider.funnel_stage,
      stage_after: rider.funnel_stage,
      reason_code: null,
      desired_action: null,
      action_completed: false,
      link_shared_confirmed: false,
      notes: null,
      next_followup_date: null,
      created_at: nowLagos()
    });
  }

  const redirectTo = isSafeLocalRedirect(req.query.redirect) ? req.query.redirect : '/priority-lists';
  res.redirect(redirectTo);
});

// ── NOWAGIEOPS LEADS (mirrors the DashSpid prospect/priority-list routes
// above, against the flatter nowagie_leads pipeline) ─────────────────────────
// Only telemarketers work NowagieOps, and it's always the whole shared
// queue — no per-marketer ownership split the way DashSpid's field
// marketers have their own leads.
function canAccessNowagie(req) {
  return req.session.marketerRole === 'telemarketer' && req.session.activeCompany === 'nowagieops';
}

const NOWAGIE_STAGE_LABELS = { new: 'New', contacted: 'Contacted', call_booked: 'Call Booked', not_interested: 'Not Interested' };

app.get('/nowagie-leads/new', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');
  const reasonCodes = await db.getNowagieReasonCodes();
  res.render('nowagie-lead-new', { error: null, reasonCodes });
});

app.post('/nowagie-leads', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');
  const { name, phone, business_name, reason_code, notes } = req.body;
  if (!name || !name.trim()) {
    const reasonCodes = await db.getNowagieReasonCodes();
    return res.render('nowagie-lead-new', { error: "Enter the lead's name.", reasonCodes });
  }

  const lead = await db.addNowagieLead({
    name: name.trim(),
    phone: phone && phone.trim() ? phone.trim() : null,
    email: null,
    business_name: business_name && business_name.trim() ? business_name.trim() : null,
    notes: notes && notes.trim() ? notes.trim() : null,
    added_by_marketer_id: req.session.marketerId,
    added_by_marketer_name: req.session.marketerName,
    channel: 'telemarketer'
  }, nowLagos());

  // Same convention as DashSpid's prospect flow — adding a lead IS the
  // day's first contact with them, so it marks contacted_at immediately
  // rather than needing a separate "Called" tap right after.
  await db.markNowagieContacted(lead.id, nowLagos());
  await db.addNowagieFollowup({
    lead_id: lead.id,
    staff_id: req.session.marketerId,
    stage_before: 'new',
    stage_after: 'contacted',
    reason_code: reason_code || null,
    outcome: null,
    notes: notes && notes.trim() ? notes.trim() : null,
    next_followup_date: null,
    source: 'app',
    created_at: nowLagos()
  });

  res.redirect(`/nowagie-leads/${lead.id}`);
});

app.get('/nowagie-queue', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');

  const counts = await nowagieLists.getAllListCounts();
  const activeList = nowagieLists.LISTS[req.query.list] ? req.query.list : 'N1';
  const meta = nowagieLists.LISTS[activeList];

  const contactedTodayIds = new Set(await db.getContactedTodayNowagieLeadIds(req.session.marketerId, today()));
  const rawRows = await nowagieLists.getListRows(activeList);
  const rows = rawRows.map(r => ({
    ...r,
    daysInStage: daysSince(r[meta.orderByColumn] || r.created_at),
    contactedToday: contactedTodayIds.has(r.id)
  }));

  const callSummary = await performance.getTodayCallSummary(req.session.marketerId, today());

  res.render('priority-lists', {
    heading: "NowagieOps Call Queue",
    baseUrl: '/nowagie-queue',
    riderBaseUrl: '/nowagie-leads',
    backHref: '/home',
    backLabel: '← Back to Home',
    viewerIsManagement: false,
    hideMyPerformance: true,
    callSummary,
    counts,
    activeList,
    activeMeta: nowagieLists.listMeta(activeList),
    rows
  });
});

app.get('/nowagie-leads/:id', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');
  const lead = await db.getNowagieLead(req.params.id);
  if (!lead) return res.redirect('/nowagie-queue');

  const followups = (await db.getFollowupsForNowagieLead(lead.id)).map(f => ({
    ...f,
    stageBeforeLabel: NOWAGIE_STAGE_LABELS[f.stage_before] || f.stage_before,
    stageAfterLabel: NOWAGIE_STAGE_LABELS[f.stage_after] || f.stage_after,
    dateFormatted: formatDateShort(f.created_at.slice(0, 10)),
    timeFormatted: formatTime(f.created_at)
  }));
  const reasonCodes = await db.getNowagieReasonCodes();

  res.render('nowagie-lead-detail', {
    lead,
    stageLabel: NOWAGIE_STAGE_LABELS[lead.stage] || lead.stage,
    followups,
    reasonCodes,
    today: today(),
    backHref: '/nowagie-queue',
    backLabel: '← Back to Call Queue'
  });
});

app.post('/nowagie-leads/:id/followups', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');
  const lead = await db.getNowagieLead(req.params.id);
  if (!lead) return res.redirect('/nowagie-queue');

  const { reason_code, outcome, notes, next_followup_date } = req.body;
  const stageBefore = lead.stage;

  await db.markNowagieContacted(lead.id, nowLagos());
  const updatedLead = await db.getNowagieLead(lead.id);

  await db.addNowagieFollowup({
    lead_id: lead.id,
    staff_id: req.session.marketerId,
    stage_before: stageBefore,
    stage_after: updatedLead.stage,
    reason_code: reason_code || null,
    outcome: outcome || null,
    notes: notes && notes.trim() ? notes.trim() : null,
    next_followup_date: next_followup_date || null,
    source: 'app',
    created_at: nowLagos()
  });

  res.redirect(`/nowagie-leads/${lead.id}`);
});

app.post('/nowagie-leads/:id/not-interested', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');
  const lead = await db.getNowagieLead(req.params.id);
  if (!lead) return res.redirect('/nowagie-queue');

  const stageBefore = lead.stage;
  await db.markNowagieNotInterested(lead.id, nowLagos());
  await db.addNowagieFollowup({
    lead_id: lead.id,
    staff_id: req.session.marketerId,
    stage_before: stageBefore,
    stage_after: 'not_interested',
    reason_code: req.body.reason_code || null,
    outcome: 'Not interested',
    notes: null,
    next_followup_date: null,
    source: 'app',
    created_at: nowLagos()
  });

  res.redirect('/nowagie-queue');
});

app.post('/nowagie-leads/:id/quick-call', requireAuth, async (req, res) => {
  if (!canAccessNowagie(req)) return res.redirect('/home');
  const lead = await db.getNowagieLead(req.params.id);
  if (!lead) return res.redirect('/nowagie-queue');

  const alreadyContacted = await db.hasContactedNowagieToday(req.session.marketerId, lead.id, today());
  if (!alreadyContacted) {
    const stageBefore = lead.stage;
    await db.markNowagieContacted(lead.id, nowLagos());
    const updatedLead = await db.getNowagieLead(lead.id);
    await db.addNowagieFollowup({
      lead_id: lead.id,
      staff_id: req.session.marketerId,
      stage_before: stageBefore,
      stage_after: updatedLead.stage,
      reason_code: null,
      outcome: null,
      notes: null,
      next_followup_date: null,
      source: 'app',
      created_at: nowLagos()
    });
  }

  const redirectTo = isSafeLocalRedirect(req.query.redirect) ? req.query.redirect : '/nowagie-queue';
  res.redirect(redirectTo);
});

app.get('/logout', requireAuth, async (req, res) => {
  if (req.session.marketerRole === 'telemarketer') {
    const sub = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
    const callSummary = await performance.getTodayCallSummary(req.session.marketerId, today());
    return res.render('logout-telemarketer', {
      name: req.session.marketerName,
      target: sub ? parseInt(sub.targets, 10) || 0 : 0,
      actualCalls: callSummary.total_calls
    });
  }
  const ridersToday = (await db.getRidersAddedByOnDate(req.session.marketerId, today())).length;
  res.render('logout', { name: req.session.marketerName, ridersToday });
});

// Target vs. what she actually logged is a real DB count, not self-reported —
// folds into the same free-text summary column the field checkout already
// writes to (no schema change). A reason is only meaningful when she fell
// short, so it's dropped from the text entirely when she hit target.
function composeTelemarketerSummary(target, actualCalls, reason) {
  const short = target - actualCalls;
  const trimmedReason = (reason || '').trim();
  return `Call target: ${target} · Logged: ${actualCalls}` +
    (short <= 0 ? ' · Hit ✓' : ` · Short by ${short}` + (trimmedReason ? ` — ${trimmedReason}` : ''));
}

app.post('/logout', requireAuth, async (req, res) => {
  const { lat, lng, accuracy, summary, reason } = req.body;
  const wantsJson = req.get('X-Requested-With') === 'fetch';

  if (lat === undefined || lng === undefined || lat === '' || lng === '') {
    const error = 'Location access is required to check out. Please enable location and try again.';
    if (wantsJson) return res.status(400).json({ ok: false, error, needsLocation: true });
    return res.status(400).send(error);
  }

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const ip = clientIp(req);
  const owner = await db.getDeviceOwner(req.deviceId);
  const marketerId = req.session.marketerId;
  const marketerName = req.session.marketerName;

  const result = await evaluateAttendance({
    marketerId,
    deviceOwnerId: owner ? owner.id : null,
    deviceOwnerName: owner ? owner.name : null,
    lat: parsedLat, lng: parsedLng, ip
  });

  const ridersToday = (await db.getRidersAddedByOnDate(marketerId, today())).length;

  let finalSummary = (summary || '').trim();
  if (req.session.marketerRole === 'telemarketer') {
    const sub = await db.getSubmissionByMarketerToday(marketerId, today());
    const callSummary = await performance.getTodayCallSummary(marketerId, today());
    finalSummary = composeTelemarketerSummary(sub ? parseInt(sub.targets, 10) || 0 : 0, callSummary.total_calls, reason);
  }

  await db.addAttendance({
    marketer_id: marketerId,
    marketer_name: marketerName,
    type: 'logout',
    lat: parsedLat,
    lng: parsedLng,
    accuracy: accuracy ? parseFloat(accuracy) : null,
    ip,
    device_id: req.deviceId,
    user_agent: req.get('User-Agent') || '',
    flagged: result.flagged,
    flags: result.flags,
    riders_onboarded: ridersToday,
    summary: finalSummary,
    address: result.address,
    timestamp: nowLagos()
  });

  req.session.destroy(() => {
    if (wantsJson) return res.json({ ok: true, redirect: '/' });
    res.redirect('/');
  });
});

// ── MANAGEMENT ROUTES ─────────────────────────────────────────────────────────

app.get('/management-login', (req, res) => {
  if (req.session.isManagement) return res.redirect('/dashboard');
  res.render('management-login', { error: null });
});

app.post('/management-login', (req, res) => {
  const { pin } = req.body;
  const wantsJson = req.get('X-Requested-With') === 'fetch';

  if (pin === (process.env.MANAGEMENT_PIN || 'dashspid2026')) {
    req.session.isManagement = true;
    if (wantsJson) return res.json({ ok: true, redirect: '/dashboard' });
    return res.redirect('/dashboard');
  }
  if (wantsJson) return res.status(401).json({ ok: false, error: 'Incorrect PIN.' });
  res.render('management-login', { error: 'Incorrect PIN.' });
});

app.get('/management/staff/new', requireManagement, (req, res) => {
  res.render('staff-new', { error: null, role: null });
});

app.post('/management/staff', requireManagement, async (req, res) => {
  const { name, pin, role } = req.body;

  if (!name || !name.trim()) {
    return res.render('staff-new', { error: 'Enter the staff member\'s name.', role });
  }
  if (!/^\d{4}$/.test(pin || '')) {
    return res.render('staff-new', { error: 'PIN must be exactly 4 digits.', role });
  }
  if (!['field_marketer', 'telemarketer'].includes(role)) {
    return res.render('staff-new', { error: 'Choose a role.', role });
  }

  // Company assignment only matters for telemarketers — field marketers are
  // DashSpid-only by definition (NowagieOps has no field/in-person role).
  const worksNowagieops = role === 'telemarketer' && req.body.works_nowagieops === '1';
  await db.addMarketer({ name: name.trim(), pin, role, worksDashspid: true, worksNowagieops });
  res.redirect('/dashboard');
});

// Collapses a flat list of login/logout events into one row per marketer per
// day (earliest login, latest logout) so management can scan a week of
// attendance without wading through every raw event.
function buildAttendanceHistory(events) {
  const grouped = {};
  events.forEach(e => {
    const date = e.timestamp.slice(0, 10);
    const key = date + '_' + e.marketer_id;
    if (!grouped[key]) {
      grouped[key] = { date, marketer_id: e.marketer_id, marketer_name: e.marketer_name, login: null, logout: null, flagged: false, ridersOnboarded: null, summary: '' };
    }
    const g = grouped[key];
    if (e.type === 'login' && (!g.login || e.timestamp < g.login)) g.login = e.timestamp;
    if (e.type === 'logout' && (!g.logout || e.timestamp > g.logout)) {
      g.logout = e.timestamp;
      g.ridersOnboarded = e.riders_onboarded != null ? e.riders_onboarded : null;
      g.summary = e.summary || '';
    }
    if (e.flagged) g.flagged = true;
  });
  return Object.values(grouped).sort((a, b) =>
    b.date.localeCompare(a.date) || a.marketer_name.localeCompare(b.marketer_name)
  );
}

function isValidDateParam(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

app.get('/management/staff-performance', requireManagement, async (req, res) => {
  const channels = await performance.getChannelBreakdown();
  const staff = await performance.getStaffBreakdown();
  res.render('staff-performance', { channels, staff });
});

app.get('/management/experiments', requireManagement, async (req, res) => {
  const experiments = (await db.getExperiments()).map(e => ({
    ...e,
    startFormatted: formatDateShort(e.start_date),
    endFormatted: e.end_date ? formatDateShort(e.end_date) : null
  }));
  res.render('experiments', { experiments, error: null });
});

app.post('/management/experiments', requireManagement, async (req, res) => {
  const { problem, hypothesis, change_description, start_date, target_metric } = req.body;
  if (!problem || !hypothesis || !change_description || !start_date || !target_metric) {
    const experiments = await db.getExperiments();
    return res.render('experiments', { experiments, error: 'Fill in problem, hypothesis, change, start date, and target metric.' });
  }
  await db.addExperiment({ ...req.body, created_by_staff_id: null, created_at: nowLagos() });
  res.redirect('/management/experiments');
});

app.post('/management/experiments/:id/result', requireManagement, async (req, res) => {
  const { result, decision, end_date } = req.body;
  await db.updateExperimentResult(req.params.id, { result, decision: decision || null, end_date: end_date || null });
  res.redirect('/management/experiments');
});

app.get('/dashboard', requireManagement, async (req, res) => {
  const overviewPeriod = ['all', 'today', 'week'].includes(req.query.overviewPeriod) ? req.query.overviewPeriod : 'all';
  const overviewToDate = today();
  const overviewFromDate = overviewPeriod === 'today' ? overviewToDate : addDaysUTC(overviewToDate, -6);
  const companyOverview = overviewPeriod === 'all'
    ? await performance.getCompanyOverview()
    : await performance.getCompanyOverview(overviewFromDate, overviewToDate);
  const cohortOverview = overviewPeriod === 'all'
    ? await performance.getCohortOverview()
    : await performance.getCohortOverview(overviewFromDate, overviewToDate);
  const cohortByChannel = {};
  for (const ch of ['field_marketer', 'telemarketer']) {
    cohortByChannel[ch] = overviewPeriod === 'all'
      ? await performance.getCohortOverview(undefined, undefined, undefined, ch)
      : await performance.getCohortOverview(overviewFromDate, overviewToDate, undefined, ch);
  }
  const usageSummary = await platformSync.getCompanyUsageSummary(overviewPeriod === 'all' ? undefined : overviewFromDate);
  const checklistAccuracy = await performance.getChecklistAccuracy();

  const marketers = await db.getMarketers();
  const statusDate = isValidDateParam(req.query.date) ? req.query.date : today();
  const statusSubs = await db.getSubmissionsToday(statusDate);
  const statusAttendance = await db.getAttendanceToday(statusDate);
  const cutoff = process.env.CHECKIN_CUTOFF || '09:00';

  const defaultTo = today();
  const defaultFrom = addDaysUTC(defaultTo, -6);

  const from = isValidDateParam(req.query.from) ? req.query.from : defaultFrom;
  const to = isValidDateParam(req.query.to) ? req.query.to : defaultTo;

  const status = marketers.map(m => {
    const sub = statusSubs.find(s => s.marketer_id === m.id);
    const checkIn = sub ? formatTime(sub.submitted_at) : null;
    const isLate = checkIn ? checkIn > cutoff : false;

    const events = statusAttendance
      .filter(a => a.marketer_id === m.id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const lastLogin = [...events].reverse().find(e => e.type === 'login');
    const lastLogout = [...events].reverse().find(e => e.type === 'logout');

    return { ...m, submitted: !!sub, checkIn, isLate,
      zone: sub?.zone || '—', targets: sub?.targets || '—', notes: sub?.notes || '—',
      loginTime: lastLogin ? formatTime(lastLogin.timestamp) : null,
      loginLat: lastLogin ? lastLogin.lat : null,
      loginLng: lastLogin ? lastLogin.lng : null,
      loginAccuracy: lastLogin ? lastLogin.accuracy : null,
      loginAddress: lastLogin ? lastLogin.address : null,
      loginDevice: lastLogin ? describeDevice(lastLogin.user_agent) : null,
      logoutTime: lastLogout ? formatTime(lastLogout.timestamp) : null,
      logoutLat: lastLogout ? lastLogout.lat : null,
      logoutLng: lastLogout ? lastLogout.lng : null,
      logoutAccuracy: lastLogout ? lastLogout.accuracy : null,
      logoutAddress: lastLogout ? lastLogout.address : null,
      logoutDevice: lastLogout ? describeDevice(lastLogout.user_agent) : null,
      ridersOnboardedToday: lastLogout ? lastLogout.riders_onboarded : null,
      daySummary: lastLogout ? lastLogout.summary : null,
      attendanceFlagged: events.some(e => e.flagged)
    };
  });

  const rangedAttendance = await db.getAttendanceInRange(from, to);
  const flaggedEvents = rangedAttendance.filter(a => a.flagged).map(a => ({
    ...a,
    device: describeDevice(a.user_agent)
  }));
  const attendanceHistory = buildAttendanceHistory(rangedAttendance).map(g => ({
    ...g,
    dateFormatted: formatDateShort(g.date),
    loginFormatted: g.login ? formatTime(g.login) : '—',
    logoutFormatted: g.logout ? formatTime(g.logout) : '—'
  }));

  const submissionsInRange = await db.getSubmissionsInRange(from, to);
  const history = submissionsInRange.map(h => ({
    ...h,
    dateFormatted: formatDateShort(h.date),
    timeFormatted: formatTime(h.submitted_at),
    isLate: formatTime(h.submitted_at) > cutoff
  }));

  const ridersInRange = await db.getRidersInRange(from, to);
  const riders = ridersInRange.map(r => ({
    ...r,
    dateAdded: formatDateShort(r.created_at.slice(0, 10)),
    timeAdded: formatTime(r.created_at),
    timeCompleted: r.completed_at ? formatTime(r.completed_at) : null,
    device: describeDevice(r.user_agent)
  }));

  res.render('dashboard', {
    status, history, flaggedEvents, attendanceHistory, riders,
    from, to,
    statusDate, statusDateFormatted: formatDateLong(statusDate), todayDateStr: today(),
    cutoff,
    formatTime, formatDateShort,
    companyOverview, cohortOverview, cohortByChannel, overviewPeriod, usageSummary, checklistAccuracy
  });
});

// Manual trigger for platformSync — lets management (and, during Phase 1
// build-out, us) confirm a match/outcome without waiting for the 5-minute
// interval. Returns counts only, no sensitive data.
app.post('/management/sync-platform', requireManagement, async (req, res) => {
  try {
    const result = await platformSync.runSync();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Manual platform sync failed:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manual trigger for the Google Sheet sync, same idea as the platform sync
// above — so a manager who just pasted a batch of leads doesn't have to wait
// for the timer. Returns counts only.
app.post('/management/sync-sheet', requireManagement, async (req, res) => {
  try {
    const result = await sheetsSync.runSync();
    if (result.skipped) return res.json({ ok: false, error: result.skipped });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Manual sheet sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Same as above, against the NowagieOps sheet (services/nowagieSheetsSync.js).
app.post('/management/sync-nowagie-sheet', requireManagement, async (req, res) => {
  try {
    const result = await nowagieSheetsSync.runSync();
    if (result.skipped) return res.json({ ok: false, error: result.skipped });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Manual NowagieOps sheet sync failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/management-logout', (req, res) => {
  req.session.isManagement = false;
  res.redirect('/management-login');
});

app.listen(PORT, () => {
  console.log(`Dashspid Checklist running on port ${PORT}`);
  console.log(`   Marketer login: http://localhost:${PORT}`);
  console.log(`   Management:     http://localhost:${PORT}/management-login`);
});

platformSync.startInterval();
sheetsSync.startInterval();
nowagieSheetsSync.startInterval();
