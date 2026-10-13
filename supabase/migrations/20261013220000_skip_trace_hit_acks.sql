-- Per-user "got it" on researcher recoveries. The skip-tracer who missed
-- sees found numbers until they click the item; then it leaves their list.
-- Shared skip_trace_cache is unchanged — other teams still get the number.

CREATE TABLE IF NOT EXISTS public.skip_trace_hit_acks (
  review_id UUID NOT NULL REFERENCES public.skip_trace_reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);

CREATE INDEX IF NOT EXISTS skip_trace_hit_acks_user_id
  ON public.skip_trace_hit_acks (user_id, acknowledged_at DESC);

COMMENT ON TABLE public.skip_trace_hit_acks IS
  'User dismissed a researcher-found skip-trace number from their inbox.';

ALTER TABLE public.skip_trace_hit_acks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.skip_trace_hit_acks FROM PUBLIC;
REVOKE ALL ON public.skip_trace_hit_acks FROM anon;
REVOKE ALL ON public.skip_trace_hit_acks FROM authenticated;
GRANT ALL ON public.skip_trace_hit_acks TO service_role;
