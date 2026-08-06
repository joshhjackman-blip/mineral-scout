-- Paste into Supabase SQL Editor → Run.
-- Fixes OwnerDrawer "martin: canceling statement due to statement timeout"
-- when loading Leases for a lead.
--
-- Same SQL as:
--   supabase/migrations/20260806200000_index_howard_martin_owner_name.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_name
  ON public.howard_mineral_ownership (owner_name);

CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_name_lower
  ON public.howard_mineral_ownership (lower(owner_name));

CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_name_trgm
  ON public.howard_mineral_ownership
  USING gin (owner_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_name
  ON public.martin_mineral_ownership (owner_name);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_name_lower
  ON public.martin_mineral_ownership (lower(owner_name));

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_name_trgm
  ON public.martin_mineral_ownership
  USING gin (owner_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_acreage
  ON public.howard_mineral_ownership (owner_name, acreage DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_acreage
  ON public.martin_mineral_ownership (owner_name, acreage DESC NULLS LAST);

-- Sanity check (should be fast after indexes build):
-- EXPLAIN ANALYZE
-- SELECT id FROM public.martin_mineral_ownership
-- WHERE owner_name = 'SOME OWNER NAME'
-- ORDER BY acreage DESC NULLS LAST
-- LIMIT 500;
