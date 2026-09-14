-- Queue for skip-traces that returned no phone number.
-- Platform owner reviews these in /owner and types in the number.

CREATE TABLE IF NOT EXISTS public.skip_trace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  owner_name_key TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  county TEXT,
  tract_abstract TEXT,
  deal_id UUID,
  team_owner_id UUID,
  requested_by UUID,
  requested_by_email TEXT,
  emails TEXT[] NOT NULL DEFAULT '{}',
  phones TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS skip_trace_reviews_open_owner_key
  ON public.skip_trace_reviews (owner_name_key)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS skip_trace_reviews_status_created
  ON public.skip_trace_reviews (status, created_at DESC);

ALTER TABLE public.skip_trace_reviews ENABLE ROW LEVEL SECURITY;

-- Writes and reads go through the service-role owner API only.
REVOKE ALL ON public.skip_trace_reviews FROM PUBLIC;
REVOKE ALL ON public.skip_trace_reviews FROM anon;
REVOKE ALL ON public.skip_trace_reviews FROM authenticated;
GRANT ALL ON public.skip_trace_reviews TO service_role;
