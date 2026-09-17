-- Storefront link + reach. Neither is COALESCE-guarded like the funnel
-- timestamps -- both are live facts that can legitimately change (a
-- business can add a custom domain later; visitor count only grows) so the
-- sync always overwrites them with the latest known value rather than
-- setting them once.
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS storefront_url VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS unique_visitor_count INT NOT NULL DEFAULT 0;
