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
- SQLite (via better-sqlite3) — zero config database
- WhatsApp notifications via CallMeBot (free)

---

## Hostinger Deployment

### 1. Upload files

Upload the entire project folder to your Hostinger Node.js hosting directory (usually `public_html` or a subdomain folder for `checklist.dashspid.com`).

### 2. Install dependencies

SSH into your Hostinger server and run:
```bash
cd /path/to/dashspid-checklist
npm install
```

### 3. Set up environment variables

Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
nano .env
```

Fill in:
- `SESSION_SECRET` — any long random string
- `CALLMEBOT_PHONE` — your WhatsApp number (international format, no +)
- `CALLMEBOT_API_KEY` — get this by messaging CallMeBot (see below)
- `MANAGEMENT_PIN` — set your own management dashboard PIN
- `PORT` — Hostinger usually assigns this automatically

### 4. Set up CallMeBot (free WhatsApp notifications)

1. Save the number **+34 644 59 92 98** in your contacts as "CallMeBot"
2. Send this exact message to that number on WhatsApp:
   `I allow callmebot to send me messages`
3. You'll receive an API key in reply
4. Add that key to your `.env` as `CALLMEBOT_API_KEY`

### 5. Start the app

On Hostinger, set the startup file to `server.js` in your Node.js app settings.
Or run manually:
```bash
node server.js
```

### 6. Point subdomain to the app

In Hostinger's control panel:
- Create subdomain: `checklist.dashspid.com`
- Point it to your Node.js app port

---

## Update Marketer PINs

After first deployment, the app seeds Etuka Joseph (PIN: 1234) and Fashi (PIN: 5678).

**Change these immediately.** Edit directly in the SQLite database:

```bash
# Install sqlite3 CLI if needed
apt-get install sqlite3

# Open the database
sqlite3 db/checklist.db

# Update PINs
UPDATE marketers SET pin = 'NEWPIN' WHERE name = 'Etuka Joseph';
UPDATE marketers SET pin = 'NEWPIN' WHERE name = 'Fashi';

# Verify
SELECT name, pin FROM marketers;

# Exit
.quit
```

## Add more marketers

```sql
INSERT INTO marketers (name, pin) VALUES ('New Marketer Name', '9999');
```

## Management Dashboard

Access at: `checklist.dashspid.com/management-login`

Default PIN: `dashspid2026` — **change this in your .env file**

---

## File structure

```
dashspid-checklist/
├── server.js          — Main app
├── package.json
├── .env               — Your config (never commit this)
├── .env.example       — Template
├── db/
│   └── database.js    — SQLite setup
├── utils/
│   └── whatsapp.js    — WhatsApp notification helper
├── views/
│   ├── login.ejs      — Marketer login
│   ├── checklist.ejs  — The morning checklist form
│   ├── submitted.ejs  — Confirmation screen
│   ├── management-login.ejs
│   └── dashboard.ejs  — Management view
└── public/
    └── style.css      — All styles
```
