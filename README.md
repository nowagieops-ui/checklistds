# Dashspid Morning Checklist App

Field marketer morning check-in system for checklist.dashspid.com

## What it does

- Field marketers log in with their name + PIN every morning
- They complete a checklist of pre-field items
- On submission, you receive a WhatsApp notification instantly
- Management dashboard shows who has checked in and who hasn't
- Auto-refreshes every 2 minutes
- 7-day submission history

## Tech stack

- Node.js + Express
- EJS templates
- MySQL (via Hostinger hPanel > Databases) — see `db/schema.sql`
- WhatsApp notifications via CallMeBot (free)
- PWA install prompt (Android installs as a WebAPK, iPhone as an Add-to-Home-Screen web app)

---

## Hostinger Deployment

### 1. Create the MySQL database

In hPanel > Databases, create a MySQL database and note the host, database name, username, and password.

Run `db/schema.sql` against it once (via phpMyAdmin's Import tab, or `mysql -u USER -p DBNAME < db/schema.sql` over SSH) to create the tables and seed the two starting marketers. If you've already changed their PINs in production, edit the `INSERT INTO marketers` values in that file first so you don't reset them.

### 2. Upload files

Upload the entire project folder to your Hostinger Node.js hosting directory (usually `public_html` or a subdomain folder for `checklist.dashspid.com`).

### 3. Install dependencies

SSH into your Hostinger server and run:
```bash
cd /path/to/dashspid-checklist
npm install
```

### 4. Set up environment variables

Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
nano .env
```

Fill in:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — from step 1
- `SESSION_SECRET` — any long random string
- `CALLMEBOT_PHONE` — your WhatsApp number (international format, no +)
- `CALLMEBOT_API_KEY` — get this by messaging CallMeBot (see below)
- `MANAGEMENT_PIN` — set your own management dashboard PIN
- `PORT` — Hostinger usually assigns this automatically

### 5. Set up CallMeBot (free WhatsApp notifications)

1. Save the number **+34 644 59 92 98** in your contacts as "CallMeBot"
2. Send this exact message to that number on WhatsApp:
   `I allow callmebot to send me messages`
3. You'll receive an API key in reply
4. Add that key to your `.env` as `CALLMEBOT_API_KEY`

### 6. Start the app

On Hostinger, set the startup file to `server.js` in your Node.js app settings.
Or run manually:
```bash
node server.js
```

### 7. Point subdomain to the app

In Hostinger's control panel:
- Create subdomain: `checklist.dashspid.com`
- Point it to your Node.js app port

---

## Update Marketer PINs

`db/schema.sql` seeds Etuka Joseph (PIN: 1043) and Chiamaka Nwoke (PIN: 2128).

**Change these immediately.** Edit directly in the MySQL database (via phpMyAdmin, or the `mysql` CLI over SSH):

```sql
UPDATE marketers SET pin = 'NEWPIN' WHERE name = 'Etuka Joseph';
UPDATE marketers SET pin = 'NEWPIN' WHERE name = 'Chiamaka Nwoke';

-- Verify
SELECT name, pin FROM marketers;
```

## Add more marketers

```sql
INSERT INTO marketers (name, pin, active) VALUES ('New Marketer Name', '9999', 1);
```

## Management Dashboard

Access at: `checklist.dashspid.com/management-login`

Default PIN: `dashspid2026` — **change this in your .env file**

---

## File structure

```
dashspid-checklist/
├── server.js               — Main app
├── package.json
├── .env                    — Your config (never commit this)
├── .env.example            — Template
├── db/
│   ├── database.js         — MySQL data access layer
│   └── schema.sql          — Run once to create tables + seed marketers
├── utils/
│   ├── whatsapp.js         — WhatsApp notification helper
│   └── attendance.js       — Buddy-punching / GPS-spoofing flag checks
├── views/
│   ├── login.ejs           — Marketer login (PIN + mandatory location)
│   ├── home.ejs            — Post-login menu
│   ├── checklist.ejs       — The morning checklist form
│   ├── submitted.ejs       — Confirmation screen
│   ├── logout.ejs          — End-of-day summary + mandatory location clock-out
│   ├── rider-new.ejs       — Rider onboarding: name/email/phone
│   ├── rider-checklist.ejs — Rider onboarding checklist
│   ├── rider-done.ejs      — Rider onboarding confirmation
│   ├── management-login.ejs
│   └── dashboard.ejs       — Management view (date-range filterable)
└── public/
    ├── style.css           — All styles
    ├── manifest.json       — PWA manifest
    ├── service-worker.js   — PWA install requirement
    ├── install-prompt.js   — Bottom install banner (Android/iPhone)
    └── icons/              — App icons
```
