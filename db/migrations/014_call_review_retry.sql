-- Lets a call review that failed for a transient reason (Gemini overloaded,
-- rate-limited) go back to "pending" and be retried automatically on a
-- longer horizon, instead of permanently failing after one bad ~15-second
-- window. attempts caps the total tries; next_attempt_at spaces them out
-- so a demand spike gets time to actually clear.
--
--   mysql -u USER -p DBNAME < db/migrations/014_call_review_retry.sql

ALTER TABLE call_reviews
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at DATETIME NULL;
