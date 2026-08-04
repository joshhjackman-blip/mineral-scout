-- Help desk tickets + allow help_ticket in email_send_log.kind

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_kind_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_kind_check
  CHECK (kind IN ('team_invite', 'demo_booking', 'help_ticket', 'other'));

CREATE TABLE IF NOT EXISTS public.help_tickets (
  id BIGSERIAL PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE,
  user_id UUID,
  from_email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_help_tickets_created_at
  ON public.help_tickets (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_help_tickets_user_id
  ON public.help_tickets (user_id);

ALTER TABLE public.help_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all help_tickets" ON public.help_tickets;
CREATE POLICY "allow all help_tickets"
  ON public.help_tickets
  FOR ALL
  USING (true)
  WITH CHECK (true);
