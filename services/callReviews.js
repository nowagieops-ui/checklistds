// AI review of a telemarketer's uploaded call recordings, for either
// business (DashSpid or NowagieOps) — she uploads at the end of the day,
// Gemini transcribes and grades each one so coaching is based on the
// actual call, not a self-report or a manager's spot-check. Reuses the
// same GEMINI_API_KEY as the training academy's roleplay feedback
// (server.js), same "never blocks, degrades to a clear error" convention.
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const db = require('../db/database');
const { nowLagos } = require('../utils/time');

const geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Sent as inline base64 in the request body (not the Files API), which has
// a practical ceiling well under this — a typical few-minute compressed
// call recording is nowhere near it. Enforced at upload time too (see
// server.js's multer limits), this is the second, authoritative check.
const MAX_INLINE_BYTES = 15 * 1024 * 1024; // 15MB

function isConfigured() {
  return !!geminiClient;
}

const PROMPT = `You are a sales call quality reviewer for a telemarketing team. They cold-call either to sell a Nigerian delivery-logistics SaaS platform, or separately to book a free strategy call for a UK brand growth agency. You are given one recorded phone call.

Do all of the following:
1. Transcribe the call as accurately as you can. Label speakers "Telemarketer" and "Prospect" where you can tell them apart.
2. Grade the call from 1 to 10 on how well the telemarketer handled it overall (opening, listening, objection handling, closing) — 10 is an excellent, textbook call. Be honest, not generous — most real calls are a 4-7.
3. Say specifically what she did well in THIS call, quoting a moment if useful.
4. Say specifically what she could have done better in THIS call, quoting a moment if useful.
5. Give a short 2-3 sentence summary of what actually happened on the call (e.g. booked a call, hit an objection, no answer, hung up early, wrong number).

If the audio is not a sales call, or is silent/unintelligible, say so plainly in "summary" and give a grade of 1.

Respond as JSON only, matching exactly this shape, no markdown fences:
{"transcript": "...", "grade": 7, "didWell": "...", "toImprove": "...", "summary": "..."}`;

async function analyzeCall(filePath, mimeType) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length > MAX_INLINE_BYTES) {
    throw new Error(`File is ${(buffer.length / 1024 / 1024).toFixed(1)}MB — keep recordings under 15MB.`);
  }

  const result = await geminiClient.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { inlineData: { mimeType: mimeType || 'audio/mpeg', data: buffer.toString('base64') } },
      { text: PROMPT }
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

// Reviews one call, oldest first across everyone. One at a time (not
// concurrent) keeps this predictable and easy to reason about rather than
// firing a burst of requests at Gemini together.
async function processOne() {
  const review = await db.getNextPendingCallReview();
  if (!review) return false;

  await db.markCallReviewProcessing(review.id);
  try {
    const analysis = await analyzeCall(review.file_path, review.mime_type);
    await db.completeCallReview(review.id, { ...analysis, processedAt: nowLagos() });
  } catch (err) {
    console.error(`callReviews: review ${review.id} failed:`, err.message);
    await db.failCallReview(review.id, err.message, nowLagos());
  } finally {
    // The raw audio is never needed again either way (analysis is stored
    // as text, or it's failed for good) — delete it so uploads don't pile
    // up on disk.
    fs.unlink(review.file_path, () => {});
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
