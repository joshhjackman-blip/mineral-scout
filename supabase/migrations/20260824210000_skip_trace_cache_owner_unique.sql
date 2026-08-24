-- Restore the UNIQUE(owner_name) constraint on the shared skip-trace cache.
--
-- The 2026-08-11 migration declared `owner_name TEXT PRIMARY KEY`, but on the
-- live database the table pre-existed, so `CREATE TABLE IF NOT EXISTS` skipped
-- it and no unique/PK on owner_name was ever created. Consequences:
--   • /api/skiptrace caches results with `.upsert(..., {onConflict:'owner_name'})`
--     — that call fails (Postgres 42P10) without a matching constraint, so live
--     skip-trace results were never getting cached (every trace re-hit a paid
--     provider), and the table sat empty.
--   • Bulk seeds (e.g. idiCORE pre-loads) can't upsert either.
--
-- Fix: normalize + de-duplicate existing rows, then add the unique constraint.

-- Normalize keys to the app's skipTraceOwnerKey format (trim + uppercase).
UPDATE public.skip_trace_cache
SET owner_name = upper(trim(owner_name))
WHERE owner_name IS DISTINCT FROM upper(trim(owner_name));

-- Collapse any case/whitespace duplicates, keeping the freshest row.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY owner_name
      ORDER BY updated_at DESC NULLS LAST
    ) AS rn
  FROM public.skip_trace_cache
)
DELETE FROM public.skip_trace_cache s
USING ranked r
WHERE s.ctid = r.ctid
  AND r.rn > 1;

DO $$
BEGIN
  ALTER TABLE public.skip_trace_cache
    ADD CONSTRAINT skip_trace_cache_owner_name_key UNIQUE (owner_name);
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint already present
  WHEN duplicate_table THEN NULL;   -- index name already taken
END $$;
