require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const db = require('./db/database');
const { sendWhatsApp } = require('./utils/whatsapp');
const { evaluateAttendance } = require('./utils/attendance');

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

function requireAuth(req, res, next) {
  if (req.session.marketerId) return next();
  res.redirect('/');
}
function requireManagement(req, res, next) {
  if (req.session.isManagement) return next();
  res.redirect('/management-login');
}
function today() {
  return new Date().toISOString().split('T')[0];
}
function formatDate() {
  return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function formatDateShort(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

  if (wantsJson) return res.json({ ok: true, redirect: '/home' });
  res.redirect('/home');
});

// A day counts green only once BOTH a login and a logout event exist for it.
// Today is never marked missed — it's still "pending" until it becomes a past
// day, at which point an incomplete day naturally falls into "missed" since
// this is recomputed fresh from today()'s date on every page load.
function buildAttendanceCalendar(events, days, toDateStr) {
  const byDate = {};
  events.forEach(e => {
    const d = e.timestamp.split('T')[0];
    if (!byDate[d]) byDate[d] = { login: false, logout: false };
    if (e.type === 'login') byDate[d].login = true;
    if (e.type === 'logout') byDate[d].logout = true;
  });

  // Pure UTC arithmetic throughout — matches today()'s UTC convention and
  // avoids local-vs-UTC date parsing mismatches shifting the calendar by a day.
  const [y, m, d0] = toDateStr.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d0 - (days - 1)));

  const calendar = [];
  for (let i = 0; i < days; i++) {
    const dateStr = cursor.toISOString().split('T')[0];
    const rec = byDate[dateStr];
    let status;
    if (rec && rec.login && rec.logout) status = 'complete';
    else if (dateStr === toDateStr) status = 'pending';
    else status = 'missed';

    calendar.push({ date: dateStr, label: cursor.getUTCDate(), status });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return calendar;
}

app.get('/home', requireAuth, async (req, res) => {
  const submittedToday = !!(await db.getSubmissionByMarketerToday(req.session.marketerId, today()));

  const calendarDays = 14;
  const toDate = today();
  const fromDateObj = new Date();
  fromDateObj.setDate(fromDateObj.getDate() - (calendarDays - 1));
  const fromDate = fromDateObj.toISOString().split('T')[0];

  const events = await db.getAttendanceForMarketerInRange(req.session.marketerId, fromDate, toDate);
  const attendanceCalendar = buildAttendanceCalendar(events, calendarDays, toDate);

  res.render('home', { name: req.session.marketerName, submittedToday, date: formatDate(), attendanceCalendar });
});

app.get('/checklist', requireAuth, async (req, res) => {
  const existing = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
  if (existing) return res.redirect('/submitted');
  res.render('checklist', { name: req.session.marketerName, date: formatDate() });
});

app.post('/submit', requireAuth, async (req, res) => {
  const existing = await db.getSubmissionByMarketerToday(req.session.marketerId, today());
  if (existing) return res.redirect('/submitted');

  const { zone, targets, notes, lat, lng, accuracy } = req.body;

  if (lat === undefined || lng === undefined || lat === '' || lng === '') {
    return res.status(400).send('Location access is required to submit your checklist. Please enable location and try again.');
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
    flags: result.flags
  });

  const checklistItems = Object.keys(req.body).filter(k => k.startsWith('item_'));

  const sub = await db.addSubmission({
    marketer_id: marketerId,
    marketer_name: marketerName,
    date: today(),
    zone: zone || '',
    targets: targets || '',
    checklist_items: checklistItems,
    notes: notes || ''
  });

  const time = formatTime(sub.submitted_at);
  const cutoff = process.env.CHECKIN_CUTOFF || '08:45';
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
    submission: sub,
    time: sub ? formatTime(sub.submitted_at) : null
  });
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

  const rider = await db.addRider({
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    added_by_marketer_id: req.session.marketerId,
    added_by_marketer_name: req.session.marketerName
  });

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
  await db.completeRiderChecklist(rider.id, checklistItems);
  res.redirect(`/riders/${rider.id}/done`);
});

app.get('/riders/:id/done', requireAuth, async (req, res) => {
  const rider = await db.getRider(req.params.id);
  if (!rider || rider.added_by_marketer_id !== req.session.marketerId) return res.redirect('/home');
  res.render('rider-done', { rider, time: rider.completed_at ? formatTime(rider.completed_at) : null });
});

app.get('/logout', requireAuth, async (req, res) => {
  const ridersToday = (await db.getRidersAddedByOnDate(req.session.marketerId, today())).length;
  res.render('logout', { name: req.session.marketerName, ridersToday });
});

app.post('/logout', requireAuth, async (req, res) => {
  const { lat, lng, accuracy, summary } = req.body;
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
    summary: (summary || '').trim()
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

// Collapses a flat list of login/logout events into one row per marketer per
// day (earliest login, latest logout) so management can scan a week of
// attendance without wading through every raw event.
function buildAttendanceHistory(events) {
  const grouped = {};
  events.forEach(e => {
    const date = e.timestamp.split('T')[0];
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

app.get('/dashboard', requireManagement, async (req, res) => {
  const marketers = await db.getMarketers();
  const todaySubs = await db.getSubmissionsToday(today());
  const todayAttendance = await db.getAttendanceToday(today());
  const cutoff = process.env.CHECKIN_CUTOFF || '08:45';

  const defaultTo = today();
  const defaultFromDate = new Date();
  defaultFromDate.setDate(defaultFromDate.getDate() - 6);
  const defaultFrom = defaultFromDate.toISOString().split('T')[0];

  const from = isValidDateParam(req.query.from) ? req.query.from : defaultFrom;
  const to = isValidDateParam(req.query.to) ? req.query.to : defaultTo;

  const status = marketers.map(m => {
    const sub = todaySubs.find(s => s.marketer_id === m.id);
    const checkIn = sub ? formatTime(sub.submitted_at) : null;
    const isLate = checkIn ? checkIn > cutoff : false;

    const events = todayAttendance
      .filter(a => a.marketer_id === m.id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const lastLogin = [...events].reverse().find(e => e.type === 'login');
    const lastLogout = [...events].reverse().find(e => e.type === 'logout');

    return { ...m, submitted: !!sub, checkIn, isLate,
      zone: sub?.zone || '—', targets: sub?.targets || '—', notes: sub?.notes || '—',
      loginTime: lastLogin ? formatTime(lastLogin.timestamp) : null,
      logoutTime: lastLogout ? formatTime(lastLogout.timestamp) : null,
      ridersOnboardedToday: lastLogout ? lastLogout.riders_onboarded : null,
      daySummary: lastLogout ? lastLogout.summary : null,
      attendanceFlagged: events.some(e => e.flagged)
    };
  });

  const rangedAttendance = await db.getAttendanceInRange(from, to);
  const flaggedEvents = rangedAttendance.filter(a => a.flagged);
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
    dateAdded: formatDateShort(r.created_at.split('T')[0]),
    timeAdded: formatTime(r.created_at),
    timeCompleted: r.completed_at ? formatTime(r.completed_at) : null
  }));

  res.render('dashboard', {
    status, history, flaggedEvents, attendanceHistory, riders,
    from, to,
    today: formatDate(),
    cutoff,
    formatTime, formatDateShort
  });
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
