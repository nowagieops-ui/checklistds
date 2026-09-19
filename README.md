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

**Already deployed?** `db/schema.sql` is just the original baseline — run every file in `db/migrations/` in numeric order (002 through 007) against your existing database too. Each is additive and safe to run once; none touch existing data. (There's no `001` — it was folded into `002_growth_os.sql`.)

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
- `GEMINI_API_KEY` — optional, powers live AI feedback in the telemarketer training academy's roleplay practice (falls back to a canned message if left blank). Get a free key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)

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
INSERT INTO marketers (name, pin, role, active) VALUES ('New Marketer Name', '9999', 'field_marketer', 1);
```

Or use the management dashboard's "+ Add Staff" form, which lets you pick Field Marketer or Telemarketer.

## Telemarketer Training Academy

New staff added with the **Telemarketer** role must complete an 8-module training academy (product knowledge, pricing, objection handling, an AI-graded live-call roleplay, and a final quiz-gated certificate) the first time they log in — they can't reach the normal app until they finish. Field marketers aren't affected.

The roleplay module's AI feedback needs `GEMINI_API_KEY` set (see above); without it, trainees still get a canned feedback message so practice still works.

## Google Sheet sync (leads + call logging)

Lets leads be bulk-pasted and calls logged in a Google Sheet instead of (or as well as) the app. Every ~3 minutes the app reads the sheet and applies it; the dashboard's "Google Sheet sync → Sync now" button forces it immediately.

**One tab per stage.** The sheet mirrors the app's priority lists, so a telemarketer opens a tab, calls everyone on it, and logs the outcome in the row. When a lead advances on the platform, the sync moves their row to the next stage's tab — the leads still on **P6** are exactly the ones who haven't registered yet, and that tab shrinks as they do.

| Tab | Who's on it |
|---|---|
| P6 New - Register | Haven't registered yet — paste new leads here |
| P1 Registered - Activate | Registered, not activated |
| P2 Activated - Share Link | Activated, link not shared |
| P3 Link Shared - Get Customers | Link shared, no customer activity |
| P4 Has Customers - First Order | Customer activity, no first order |
| P5 Ordered - Repeat Order | Ordered, no repeat yet |
| Graduated | Repeat customers — nothing left to chase |

A read-only **Funnel Overview** tab (last) shows every lead against every stage: **green ✓ Done** (already past that stage), **black ● Here** (the stage they're at — the ones to call), **gray – Not yet**. Rows are sorted furthest-behind first, and three summary rows at the top give the counts per stage ("Here / Done / Not there yet"), matching the dashboard funnel. Nobody types in it — the app rewrites it whenever something changes — so leads are never duplicated across the work tabs and can't be called twice from two places.

All leads appear, whichever channel sourced them (see the **Source** column). The tabs are created and formatted (frozen header, dropdowns, plain-text phone column, filter) automatically on the first sync.

**One-time setup**

1. Run `db/migrations/009_google_sheet_sync.sql`, then `010_reset_sheet_sync_for_stage_tabs.sql`.
2. In [Google Cloud Console](https://console.cloud.google.com/): create a project → enable the **Google Sheets API** → *IAM & Admin → Service Accounts* → create one → *Keys → Add key → JSON* and download it.
3. Create a Google Sheet and share it with the service account's `client_email` as **Editor**. (Any pre-existing tab is left alone — the sync only uses the seven tabs above.)
4. Set the env vars (from the downloaded JSON): `GOOGLE_SHEETS_SPREADSHEET_ID` (the long id in the sheet's URL), `GOOGLE_SERVICE_ACCOUNT_EMAIL` (`client_email`), `GOOGLE_PRIVATE_KEY` (`private_key`), and `SHEETS_DEFAULT_STAFF_ID` (the telemarketer who works the sheet, a `marketers.id`: calls typed in the sheet are credited to them, and pasted rows with a blank "Assigned To" go to them).
5. Restart. The first sync creates the tabs and places every lead on the right one.

**How it behaves.** Columns A–J are input, K–O are written by the app — never both sides for the same cell, so there are no edit conflicts.

| Column | Purpose |
|---|---|
| A App ID | Leave blank for new rows — the app fills it in |
| B–E Name, Phone, Area / Notes, Assigned To | Lead details. "Assigned To" is the lead's owner (for existing leads, whoever sourced them). Only a phone is required; a blank name becomes `Lead 0803…`. A phone already in the system links to that lead instead of duplicating it |
| F–J Call Outcome, Reason, Feedback, Next Follow-up, Link Shared? | Each change to this block logs one call, credited to the telemarketer (`SHEETS_DEFAULT_STAFF_ID`) — not the lead's original owner — and visible on their pages and the manager dashboard. Dropdowns are suggestions — typing something else is fine |
| K–O Source, Calls Logged, Last Called, Last Feedback, Sync Status | Written by the app. A row that can't be applied says why in Sync Status |

Leads created in the app are added to the sheet automatically. Deleting a sheet row does not delete the lead, and it won't be re-added. A row is moved by adding it to the new tab and then removing the old one, so a moved lead's call-log cells start blank on its new tab (its history stays on the lead, and shows in Last Feedback). Don't sort the sheet at the exact moment a sync runs.

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
│   ├── schema.sql          — Run once to create tables + seed marketers (fresh installs)
│   └── migrations/
│       └── 001_telemarketer_training.sql — Run once against an already-deployed DB
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
│   ├── training.ejs        — Telemarketer training academy (gated before first /home)
│   ├── management-login.ejs
│   ├── staff-new.ejs       — Management "+ Add Staff" form (role picker)
│   └── dashboard.ejs       — Management view (date-range filterable)
└── public/
    ├── style.css           — All styles
    ├── manifest.json       — PWA manifest
    ├── service-worker.js   — PWA install requirement
    ├── install-prompt.js   — Bottom install banner (Android/iPhone)
    └── icons/              — App icons
```
