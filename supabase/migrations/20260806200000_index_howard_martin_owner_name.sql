-- Hotfix — OwnerDrawer Leases tab times out on martin_mineral_ownership
-- with: "canceling statement due to statement timeout".
--
-- Cause: .ilike('owner_name', …) against a large Permian ownership roll
-- with no usable index → sequential scan past Supabase's statement
-- timeout. Gonzales already has these indexes (20260416010000 /
-- 20260416020000); Howard/Martin were created later via LIKE and never
-- got the owner_name search indexes.
--
-- Safe to re-run (IF NOT EXISTS). Prefer running in Supabase SQL editor
-- if the migration runner isn't wired for this project.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Howard
CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_name
  ON public.howard_mineral_ownership (owner_name);

CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_name_lower
  ON public.howard_mineral_ownership (lower(owner_name));

CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_name_trgm
  ON public.howard_mineral_ownership
  USING gin (owner_name gin_trgm_ops);

-- Martin (the table that is timing out in production)
CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_name
  ON public.martin_mineral_ownership (owner_name);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_name_lower
  ON public.martin_mineral_ownership (lower(owner_name));

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_name_trgm
  ON public.martin_mineral_ownership
  USING gin (owner_name gin_trgm_ops);

-- Helps the drawer's ORDER BY acreage DESC after the owner filter.
CREATE INDEX IF NOT EXISTS idx_howard_ownership_owner_acreage
  ON public.howard_mineral_ownership (owner_name, acreage DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_owner_acreage
  ON public.martin_mineral_ownership (owner_name, acreage DESC NULLS LAST);
