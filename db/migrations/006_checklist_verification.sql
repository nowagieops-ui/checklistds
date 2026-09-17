-- Cross-checks two onboarding-checklist claims (item_pricing, item_payout)
-- against the real platform data, for riders whose checklist is complete
-- AND who are linked to a platform business. NULL = not yet determined
-- (not linked, or not synced yet) -- distinct from 0 (checked the box, but
-- it is not actually true on the platform).
--
-- Deliberately NOT verifying "Connected WhatsApp" (whatsapp_phone_number_id
-- is null on every real field/telemarketer-sourced business right now --
-- a known platform-side tracking bug, not a Staff Ops problem to paper
-- over) or "Set availability" (business_hours is auto-populated with an
-- identical default for every business regardless of whether they touched
-- it, so its presence proves nothing).
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS checklist_pricing_verified TINYINT(1) NULL,
  ADD COLUMN IF NOT EXISTS checklist_payout_verified TINYINT(1) NULL;
