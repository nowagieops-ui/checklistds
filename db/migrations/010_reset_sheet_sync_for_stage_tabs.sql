-- Run once, after 009 and before deploying the stage-tab version of the
-- Google Sheet sync. The first version kept every lead on a single "Leads"
-- tab and recorded each one here; the sync now uses one tab per priority
-- list and treats a mapped-but-missing lead as "deliberately deleted", so the
-- old rows would stop those leads ever being added to the new tabs.
-- Clearing it lets the next sync place every lead on its stage tab. No lead
-- data is touched — this table only tracks what the sheet has already seen.
DELETE FROM sheet_sync_rows;
