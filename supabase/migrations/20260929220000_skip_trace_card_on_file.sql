-- Card on file for month-end skip-trace charges ($1 per phone hit).
-- Access stays free; this is not a seat subscription.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS has_card BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS skip_trace_past_due BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method_brand TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_last4 TEXT;

COMMENT ON COLUMN public.subscriptions.has_card IS
  'Team admin saved a default card for month-end skip-trace charges.';
COMMENT ON COLUMN public.subscriptions.skip_trace_past_due IS
  'True when the latest skip-trace invoice payment failed. Blocks new billable skip-traces until the card is updated and the invoice is paid.';
COMMENT ON COLUMN public.subscriptions.payment_method_brand IS
  'Card brand from Stripe (visa, mastercard, …) for Account UI.';
COMMENT ON COLUMN public.subscriptions.payment_method_last4 IS
  'Last four digits of the default card.';
