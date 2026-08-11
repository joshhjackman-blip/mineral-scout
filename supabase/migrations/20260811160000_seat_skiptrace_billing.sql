-- Seat ($100/mo) + metered skip-trace ($0.50) billing columns.
-- Catalog Price / Meter IDs live in env; we persist the live Stripe
-- subscription + customer ids and the seat quantity on the row.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_seat_price_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_skiptrace_price_id TEXT;

COMMENT ON COLUMN public.subscriptions.seat_count IS
  'Licensed seats billed at $100/mo each. Admin seat counts against capacity.';
COMMENT ON COLUMN public.subscriptions.stripe_seat_price_id IS
  'Stripe Price id for the per-seat recurring item on this subscription.';
COMMENT ON COLUMN public.subscriptions.stripe_skiptrace_price_id IS
  'Stripe metered Price id ($0.50/unit) attached for billable skip-traces.';
