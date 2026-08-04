-- Admin Usage tab instrumentation.
--
-- 1) email_send_log — count Resend platform emails (invites, demo bookings)
-- 2) usage_events — lightweight click events (e.g. tel: call clicks)

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL
    CHECK (kind IN ('team_invite', 'demo_booking', 'other')),
  to_email TEXT NOT NULL,
  user_id UUID,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_created_at
  ON public.email_send_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_send_log_kind_created
  ON public.email_send_log (kind, created_at DESC);

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all email_send_log" ON public.email_send_log;
CREATE POLICY "allow all email_send_log"
  ON public.email_send_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.usage_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('call_clicked', 'email_clicked', 'other')),
  user_id UUID,
  county_id TEXT,
  owner_name TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created_at
  ON public.usage_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_type_created
  ON public.usage_events (event_type, created_at DESC);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all usage_events" ON public.usage_events;
CREATE POLICY "allow all usage_events"
  ON public.usage_events
  FOR ALL
  USING (true)
  WITH CHECK (true);
