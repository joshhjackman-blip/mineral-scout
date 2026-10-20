-- Prepaid provider quota burn (idiCORE / Accurate Append).
-- Live lookups fill skip_trace_cache and are not billed to customer teams.
-- Attempts are unique per month+provider+owner so a credit is never spent twice.

CREATE TABLE IF NOT EXISTS public.skip_trace_provider_usage (
  month text NOT NULL,
  provider text NOT NULL,
  live_calls integer NOT NULL DEFAULT 0,
  hits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, provider)
);

CREATE TABLE IF NOT EXISTS public.skip_trace_quota_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  month text NOT NULL,
  target_count integer NOT NULL DEFAULT 0,
  processed integer NOT NULL DEFAULT 0,
  hits integer NOT NULL DEFAULT 0,
  misses integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  cad_table_index integer NOT NULL DEFAULT 0,
  cad_offset integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skip_trace_quota_jobs_status_idx
  ON public.skip_trace_quota_jobs (status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS skip_trace_quota_jobs_active_provider_month_idx
  ON public.skip_trace_quota_jobs (month, provider)
  WHERE status IN ('queued', 'running', 'paused');

CREATE TABLE IF NOT EXISTS public.skip_trace_quota_attempts (
  month text NOT NULL,
  provider text NOT NULL,
  owner_name text NOT NULL,
  hit boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, provider, owner_name)
);

ALTER TABLE public.skip_trace_provider_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skip_trace_quota_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skip_trace_quota_attempts ENABLE ROW LEVEL SECURITY;
