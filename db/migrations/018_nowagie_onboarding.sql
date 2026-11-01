-- Track completion of the standalone NowagieOps onboarding guide separately
-- from the Week 1 training academy.
ALTER TABLE marketers
  ADD COLUMN IF NOT EXISTS nowagie_onboarding_completed_at DATETIME NULL;
