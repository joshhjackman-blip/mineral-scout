-- Signup requests: Get started → email Mineral Map → accept/decline →
-- Resend sends the applicant a join link to finish onboarding
-- (password, PSA, card on file, team-admin vs individual).

CREATE TABLE IF NOT EXISTS public.signup_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'onboarded')),
  decision_token_hash TEXT NOT NULL UNIQUE,
  wants_admin BOOLEAN,
  seat_count INTEGER,
  user_id UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  decline_reason TEXT,
  onboarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS signup_requests_pending_email_uidx
  ON public.signup_requests (lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_signup_requests_status_created
  ON public.signup_requests (status, created_at DESC);

ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;

-- No client policies: service-role only (public form + owner APIs).
DROP POLICY IF EXISTS "signup_requests_no_client" ON public.signup_requests;

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_kind_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_kind_check
  CHECK (kind IN (
    'team_invite',
    'demo_booking',
    'help_ticket',
    'signup_request',
    'signup_invite',
    'signup_declined',
    'other'
  ));

COMMENT ON TABLE public.signup_requests IS
  'Access requests from /get-started. Mineral Map accepts or declines; accepted applicants get a Resend join link.';
