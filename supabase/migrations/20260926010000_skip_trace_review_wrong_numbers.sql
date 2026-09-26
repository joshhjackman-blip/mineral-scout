-- Track skip-traces that returned no phone AND numbers callers marked wrong
-- so /owner can replace them.

ALTER TABLE public.skip_trace_reviews
  ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'no_phone';

ALTER TABLE public.skip_trace_reviews
  DROP CONSTRAINT IF EXISTS skip_trace_reviews_reason_check;

ALTER TABLE public.skip_trace_reviews
  ADD CONSTRAINT skip_trace_reviews_reason_check
  CHECK (reason IN ('no_phone', 'wrong_number'));

COMMENT ON COLUMN public.skip_trace_reviews.reason IS
  'no_phone = skip-trace returned no number; wrong_number = caller marked the number as wrong.';
