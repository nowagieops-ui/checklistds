// AI review of a telemarketer's uploaded call recordings, for either
// business (DashSpid or NowagieOps) — she uploads at the end of the day,
// Gemini transcribes and grades each one so coaching is based on the
// actual call, not a self-report or a manager's spot-check. Reuses the
// same GEMINI_API_KEY as the training academy's roleplay feedback
// (server.js), same "never blocks, degrades to a clear error" convention.
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const db = require('../db/database');
const { nowLagos, toLagosDateTime } = require('../utils/time');
const trainingWeeks = require('./trainingWeeks');

const geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Sent as inline base64 in the request body (not the Files API), which has
// a practical ceiling well under this — a typical few-minute compressed
// call recording is nowhere near it. Enforced at upload time too (see
// server.js's multer limits), this is the second, authoritative check.
const MAX_INLINE_BYTES = 15 * 1024 * 1024; // 15MB

function isConfigured() {
  return !!geminiClient;
}

// Flattens a training week's content blocks (everything except the quiz and
// the roleplay module) into plain text — this is how the grader gets real
// product knowledge (every plan, price, feature, and the Rider Hub/Shield
// for DashSpid; every service and the booking ask for NowagieOps) instead
// of a thin hand-written summary that drifts out of sync. Week 1 is the
// foundation week for both academies, so it's the single source of truth
// here — if the curriculum changes, the grader's knowledge changes with it.
function flattenWeekContent(weekData) {
  const lines = [];
  weekData.modules.forEach(m => {
    if (m.isRoleplay) return;
    lines.push(`## ${m.title}`);
    (m.content || []).forEach(block => {
      if (block.callout) { lines.push(`Note: ${block.callout}`); return; }
      if (block.type === 'table') {
        lines.push(block.headers.join(' | '));
        block.rows.forEach(row => lines.push(row.join(' | ')));
        return;
      }
      if (block.example) { lines.push(`Example — ${block.example.label}: ${block.example.text}`); return; }
      if (block.script) {
        lines.push(`Script — ${block.script.label}: ${block.script.text}`);
        if (block.script.response) lines.push(`  Response: ${block.script.response}`);
        return;
      }
      if (block.steps) {
        if (block.header) lines.push(block.header);
        block.steps.forEach(s => lines.push(`  ${s.num}. ${s.title} — ${s.body}`));
        return;
      }
      if (block.header) lines.push(block.header);
      if (block.body) lines.push(block.body);
      if (block.bullets) block.bullets.forEach(b => lines.push(`- ${b}`));
    });
  });
  if (weekData.cheatsheet) {
    lines.push('## Quick Facts');
    weekData.cheatsheet.forEach(c => lines.push(`${c.label}: ${c.value}`));
  }
  return lines.join('\n');
}

// Built once at startup, not per call — these files only change on a
// deploy, and flattening them is pure computation with no I/O to repeat.
const PRODUCT_BRIEFS = {
  dashspid: flattenWeekContent(trainingWeeks.loadWeek(1, 'dashspid')),
  nowagieops: flattenWeekContent(trainingWeeks.loadWeek(1, 'nowagieops'))
};

const COMPANY_LABEL = { dashspid: 'Dashspid (Nigerian delivery-logistics SaaS)', nowagieops: 'NowagieOps (UK brand growth agency)' };

// extraKnowledge is whatever management has pasted in at
// /management/knowledge (db.company_knowledge) — entirely optional, on top
// of the Week 1 brief above, re-fetched fresh per call since (unlike the
// training files) it can be edited at any time.
function buildPrompt(company, extraKnowledge) {
  const track = company === 'nowagieops' ? 'nowagieops' : 'dashspid';
  const extraBlock = extraKnowledge && extraKnowledge.trim()
    ? `\n━━━ ADDITIONAL KNOWLEDGE (provided by management) ━━━\n${extraKnowledge.trim()}\n━━━ END ADDITIONAL KNOWLEDGE ━━━\n`
    : '';
  return `You are a sales call quality reviewer for a telemarketing team selling ${COMPANY_LABEL[track]}. You are given one recorded phone call. Use the product knowledge below to judge not just HOW she sold, but WHETHER what she said was actually correct — a confident answer that gets the price, a feature, or a policy wrong is a real mistake, not a stylistic quibble.

━━━ PRODUCT KNOWLEDGE (${track === 'nowagieops' ? 'NowagieOps' : 'DashSpid'}) ━━━
${PRODUCT_BRIEFS[track]}
━━━ END PRODUCT KNOWLEDGE ━━━
${extraBlock}
Do all of the following:
1. Transcribe the call as accurately as you can. Label speakers "Telemarketer" and "Prospect" where you can tell them apart.
2. Grade the call from 1 to 10 on how well the telemarketer handled it — opening with the prospect's pain (not a pitch), one thing explained deep rather than a feature dump, questions before pitching, objections answered then re-engaged, factual accuracy against the product knowledge above, and a close that ends with a named concrete outcome. 10 is an excellent, textbook call. Be honest, not generous — most real calls are a 4-7.
3. "didWell" — a real bulleted breakdown, not one blanket sentence: one bullet per distinct good moment in the call (an opening line, a specific question, handling a specific objection, tone, rapport, whatever actually happened), quoting or closely paraphrasing the moment. A longer call should produce more bullets, covering the call roughly start to finish, not just one overall takeaway. Use literal "- " at the start of each line, one per line.
4. "toImprove" — same format, one bullet per distinct issue, in the order they happened in the call: a missed opportunity, a weak answer, a factual mistake against the product knowledge above (wrong price, wrong feature, wrong policy — name it explicitly), a place she talked over the prospect, etc. If a call is genuinely clean, say so, but still look for the small stuff (pace, filler words, a follow-up question she didn't ask) rather than leaving this empty.
5. "summary" — a short 2-3 sentence overview of what actually happened on the call (e.g. booked a call, hit an objection, no answer, hung up early, wrong number). This one stays brief — it's the at-a-glance version; didWell/toImprove are where the detail goes.

If the audio is not a sales call, or is silent/unintelligible, say so plainly in "summary" and give a grade of 1.

Respond as JSON only, matching exactly this shape, no markdown fences:
{"transcript": "...", "grade": 7, "didWell": "- ...\\n- ...", "toImprove": "- ...\\n- ...", "summary": "..."}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Google's own overload/rate-limit errors (503 UNAVAILABLE, 429 with a
// retryable status) are transient — a spike that clears in seconds, not a
// real failure. Retrying a couple of times with a short backoff avoids
// permanently marking a call "Couldn't review" over Google's momentary
// traffic, while still giving up (and surfacing the real error) for
// anything that won't fix itself on retry, like bad billing or a bad model
// name.
const RETRYABLE_PATTERN = /"status"\s*:\s*"(UNAVAILABLE|RESOURCE_EXHAUSTED)"|"code"\s*:\s*(503|429)\b/;

async function generateWithRetry(request, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await geminiClient.models.generateContent(request);
    } catch (err) {
      const retryable = RETRYABLE_PATTERN.test(err.message || '');
      if (!retryable || i === attempts) throw err;
      await sleep(5000 * i); // 5s, then 10s
    }
  }
}

async function analyzeCall(filePath, mimeType, company) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_INLINE_BYTES) {
    throw new Error(`File is ${(buffer.length / 1024 / 1024).toFixed(1)}MB — keep recordings under 15MB.`);
  }
  const extraKnowledge = await db.getCompanyKnowledge(company === 'nowagieops' ? 'nowagieops' : 'dashspid');

  const result = await generateWithRetry({
    model: 'gemini-3.8-flash',
    contents: [
      { inlineData: { mimeType: mimeType || 'audio/mpeg', data: buffer.toString('base64') } },
      { text: buildPrompt(company, extraKnowledge) }
    ],
    config: { responseMimeType: 'application/json' }
  });

  const raw = result.text;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('Gemini did not return valid JSON: ' + String(raw || '').slice(0, 200));
  }
  if (!parsed || parsed.grade === undefined) {
    throw new Error('Gemini response was missing expected fields');
  }

  const grade = Math.round(Number(parsed.grade));
  return {
    transcript: parsed.transcript || '',
    grade: Number.isFinite(grade) ? Math.max(1, Math.min(10, grade)) : null,
    didWell: parsed.didWell || '',
    toImprove: parsed.toImprove || '',
    summary: parsed.summary || ''
  };
}

let running = false;

// A demand spike can outlast the ~15s of in-call retries in analyzeCall —
// this is the second, longer-horizon layer: up to 5 total attempts,
// spaced further apart each time (2, 4, 6, 8 minutes), before finally
// giving up for good.
const MAX_ATTEMPTS = 5;

// Reviews one call, oldest (and due) first across everyone. One at a time
// (not concurrent) keeps this predictable and easy to reason about rather
// than firing a burst of requests at Gemini together.
async function processOne() {
  const review = await db.getNextPendingCallReview(nowLagos());
  if (!review) return false;

  await db.markCallReviewProcessing(review.id);
  let keepFile = false;
  try {
    const analysis = await analyzeCall(review.file_path, review.mime_type, review.company);
    await db.completeCallReview(review.id, { ...analysis, processedAt: nowLagos() });
  } catch (err) {
    const attempts = (review.attempts || 0) + 1;
    const willRetry = RETRYABLE_PATTERN.test(err.message || '') && attempts < MAX_ATTEMPTS;
    console.error(`callReviews: review ${review.id} failed (attempt ${attempts}${willRetry ? ', will retry' : ', giving up'}):`, err.message);
    if (willRetry) {
      const nextAttemptAt = toLagosDateTime(new Date(Date.now() + Math.min(attempts * 2, 8) * 60 * 1000));
      await db.retryCallReviewLater(review.id, nextAttemptAt, attempts);
      keepFile = true; // still needed for the retry
    } else {
      const finalMessage = attempts > 1 ? `${err.message} (tried ${attempts} times)` : err.message;
      await db.failCallReview(review.id, finalMessage, nowLagos());
    }
  } finally {
    // The raw audio is only deleted once there's nothing left to retry —
    // done, or permanently failed. A queued retry needs it kept.
    if (!keepFile) fs.unlink(review.file_path, () => {});
  }
  return true;
}

// Works straight through the whole pending queue back-to-back (no
// artificial gap between files) rather than one file per timer tick —
// otherwise a batch of 50 would take 50x the poll interval for no reason.
// The poll interval below is just how often it checks for new work once
// the queue is empty.
async function processNext() {
  if (running || !isConfigured()) return;
  running = true;
  try {
    while (await processOne()) { /* keep going while there's more queued */ }
  } finally {
    running = false;
  }
}

function startInterval(intervalMs = 20 * 1000) {
  if (!isConfigured()) {
    console.log('callReviews: GEMINI_API_KEY not set — call review analysis disabled');
    return;
  }
  setInterval(() => processNext().catch(err => console.error('callReviews tick failed:', err.message)), intervalMs);
}

module.exports = { isConfigured, startInterval, processNext, MAX_INLINE_BYTES };
