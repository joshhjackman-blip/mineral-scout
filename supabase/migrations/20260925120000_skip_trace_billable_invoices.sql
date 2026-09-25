-- Team skip-trace billing: $1 per phone hit, running monthly total,
-- Stripe Invoicing at month end (not per-event Billing Meters).

ALTER TABLE public.skip_trace_usage
  ADD COLUMN IF NOT EXISTS billable_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.skip_trace_usage.count IS
  'Provider calls this month (cache misses). Includes misses and email-only.';
COMMENT ON COLUMN public.skip_trace_usage.billable_count IS
  'Phone-hit lookups billed at $1 each on the team month-end Stripe invoice. Cache hits, misses, email-only, and billing_exempt workspaces stay 0.';

CREATE TABLE IF NOT EXISTS public.skip_trace_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_owner_id UUID NOT NULL REFERENCES auth.users(id),
  month TEXT NOT NULL,
  billable_count INTEGER NOT NULL DEFAULT 0,
  amount_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_invoice_id TEXT,
  hosted_invoice_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_owner_id, month)
);

CREATE INDEX IF NOT EXISTS idx_skip_trace_invoices_month
  ON public.skip_trace_invoices (month DESC);

ALTER TABLE public.skip_trace_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skip_trace_invoices_select_own_team" ON public.skip_trace_invoices;
CREATE POLICY "skip_trace_invoices_select_own_team"
  ON public.skip_trace_invoices
  FOR SELECT
  TO authenticated
  USING (
    team_owner_id = auth.uid()
    OR team_owner_id = (
      SELECT s.team_owner_id
      FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
      LIMIT 1
    )
  );
