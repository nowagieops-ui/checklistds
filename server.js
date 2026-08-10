require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db/database');
const { sendWhatsApp } = require('./utils/whatsapp');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dashspid-secret-change-this',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 10 * 60 * 60 * 1000 }
}));

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

app.get('/', (req, res) => {
  if (req.session.marketerId) return res.redirect('/checklist');
  const marketers = db.getMarketers();
  res.render('login', { marketers, error: null });
});

app.post('/login', (req, res) => {
  const { marketer_id, pin } = req.body;
  const marketer = db.getMarketer(marketer_id, pin);
  if (!marketer) {
    return res.render('login', { marketers: db.getMarketers(), error: 'Incorrect PIN. Please try again.' });
  }
  req.session.marketerId = marketer.id;
  req.session.marketerName = marketer.name;
  res.redirect('/checklist');
});

app.get('/checklist', requireAuth, (req, res) => {
  const existing = db.getSubmissionByMarketerToday(req.session.marketerId, today());
  if (existing) return res.redirect('/submitted');
  res.render('checklist', { name: req.session.marketerName, date: formatDate() });
});

app.post('/submit', requireAuth, (req, res) => {
  const existing = db.getSubmissionByMarketerToday(req.session.marketerId, today());
  if (existing) return res.redirect('/submitted');

  const { zone, targets, notes } = req.body;
  const checklistItems = Object.keys(req.body).filter(k => k.startsWith('item_'));

  const sub = db.addSubmission({
    marketer_id: req.session.marketerId,
    marketer_name: req.session.marketerName,
    date: today(),
    zone: zone || '',
    targets: targets || '',
    checklist_items: JSON.stringify(checklistItems),
    notes: notes || ''
  });

  const time = formatTime(sub.submitted_at);
  const cutoff = process.env.CHECKIN_CUTOFF || '08:45';
  const isLate = time > cutoff;
  const status = isLate ? '⚠️ LATE' : '✅ ON TIME';

  sendWhatsApp(
    `${status} — ${req.session.marketerName} checked in at ${time}\nZone: ${zone || 'Not set'}\nTargets: ${targets || 'Not set'}`
  );

  res.redirect('/submitted');
});

app.get('/submitted', requireAuth, (req, res) => {
  const sub = db.getSubmissionByMarketerToday(req.session.marketerId, today());
  res.render('submitted', {
    name: req.session.marketerName,
    submission: sub,
    time: sub ? formatTime(sub.submitted_at) : null
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── MANAGEMENT ROUTES ─────────────────────────────────────────────────────────

app.get('/management-login', (req, res) => {
  if (req.session.isManagement) return res.redirect('/dashboard');
  res.render('management-login', { error: null });
});

app.post('/management-login', (req, res) => {
  const { pin } = req.body;
  if (pin === (process.env.MANAGEMENT_PIN || 'dashspid2026')) {
    req.session.isManagement = true;
    return res.redirect('/dashboard');
  }
  res.render('management-login', { error: 'Incorrect PIN.' });
});

app.get('/dashboard', requireManagement, (req, res) => {
  const marketers = db.getMarketers();
  const todaySubs = db.getSubmissionsToday(today());
  const cutoff = process.env.CHECKIN_CUTOFF || '08:45';

  const status = marketers.map(m => {
    const sub = todaySubs.find(s => s.marketer_id === m.id);
    const checkIn = sub ? formatTime(sub.submitted_at) : null;
    const isLate = checkIn ? checkIn > cutoff : false;
    return { ...m, submitted: !!sub, checkIn, isLate,
      zone: sub?.zone || '—', targets: sub?.targets || '—', notes: sub?.notes || '—' };
  });

  const history = db.getRecentSubmissions(7).map(h => ({
    ...h,
    dateFormatted: formatDateShort(h.date),
    timeFormatted: formatTime(h.submitted_at),
    isLate: formatTime(h.submitted_at) > cutoff
  }));

  res.render('dashboard', {
    status, history,
    today: formatDate(),
    cutoff,
    formatTime
  });
});

app.get('/management-logout', (req, res) => {
  req.session.isManagement = false;
  res.redirect('/management-login');
});

app.listen(PORT, () => {
  console.log(`✅ Dashspid Checklist running on port ${PORT}`);
  console.log(`   Marketer login: http://localhost:${PORT}`);
  console.log(`   Management:     http://localhost:${PORT}/management-login`);
});
