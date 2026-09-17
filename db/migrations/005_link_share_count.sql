-- Backed by the new link_share_events table on the platform (dashspid
-- migration 20260918_add_link_share_events.sql), fired when a business
-- clicks "Copy link" on their storefront URL. This counts share ATTEMPTS,
-- not reach -- there is still no way to know how many people they actually
-- sent it to.
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS link_share_count INT NOT NULL DEFAULT 0;
