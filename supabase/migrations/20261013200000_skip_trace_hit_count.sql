-- Successful skip-traces (phone returned), independent of $1 billing.
-- Waived teams (Mineral Map / Great Plains) never increment billable_count,
-- so owner dashboards need this column to show hit vs miss.

ALTER TABLE public.skip_trace_usage
  ADD COLUMN IF NOT EXISTS hit_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.skip_trace_usage.hit_count IS
  'Live lookups this month that returned a phone number, including waived owner teams. Cache hits are not counted.';

-- Paid teams already stored phone hits in billable_count.
UPDATE public.skip_trace_usage
SET hit_count = billable_count
WHERE hit_count = 0
  AND billable_count > 0;
