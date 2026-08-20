-- Indexes for the five new Permian county ownership tables (Loving, Midland,
-- Reagan, Upton, Ward). Mirrors 20260807150000 (abstract) + 20260806200000
-- (owner_name) for Howard/Martin.
--
-- Without an abstract index, the per-tract owner lookup
--   .in('abstract', ['62','A-62']) on <county>_mineral_ownership
-- sequential-scans a 130k–440k-row roll and hits Supabase's statement
-- timeout, so the tract owner panel shows nothing. Owner search's
-- ilike('owner_name', …) needs the trigram/name indexes for the same reason.
--
-- Safe to re-run (IF NOT EXISTS). Run in the Supabase SQL editor if the
-- migration runner isn't wired for this project.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- abstract (per-tract owner lookup)
CREATE INDEX IF NOT EXISTS idx_loving_ownership_abstract  ON public.loving_mineral_ownership  (abstract);
CREATE INDEX IF NOT EXISTS idx_midland_ownership_abstract ON public.midland_mineral_ownership (abstract);
CREATE INDEX IF NOT EXISTS idx_reagan_ownership_abstract  ON public.reagan_mineral_ownership  (abstract);
CREATE INDEX IF NOT EXISTS idx_upton_ownership_abstract   ON public.upton_mineral_ownership   (abstract);
CREATE INDEX IF NOT EXISTS idx_ward_ownership_abstract    ON public.ward_mineral_ownership    (abstract);

-- owner_name (OwnerDrawer holdings + owner search)
CREATE INDEX IF NOT EXISTS idx_loving_ownership_owner_name  ON public.loving_mineral_ownership  (owner_name);
CREATE INDEX IF NOT EXISTS idx_midland_ownership_owner_name ON public.midland_mineral_ownership (owner_name);
CREATE INDEX IF NOT EXISTS idx_reagan_ownership_owner_name  ON public.reagan_mineral_ownership  (owner_name);
CREATE INDEX IF NOT EXISTS idx_upton_ownership_owner_name   ON public.upton_mineral_ownership   (owner_name);
CREATE INDEX IF NOT EXISTS idx_ward_ownership_owner_name    ON public.ward_mineral_ownership    (owner_name);

CREATE INDEX IF NOT EXISTS idx_loving_ownership_owner_name_trgm  ON public.loving_mineral_ownership  USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_midland_ownership_owner_name_trgm ON public.midland_mineral_ownership USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reagan_ownership_owner_name_trgm  ON public.reagan_mineral_ownership  USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_upton_ownership_owner_name_trgm   ON public.upton_mineral_ownership   USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ward_ownership_owner_name_trgm    ON public.ward_mineral_ownership    USING gin (owner_name gin_trgm_ops);

-- owner_name + acreage (drawer ORDER BY acreage DESC after the owner filter)
CREATE INDEX IF NOT EXISTS idx_loving_ownership_owner_acreage  ON public.loving_mineral_ownership  (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_midland_ownership_owner_acreage ON public.midland_mineral_ownership (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_reagan_ownership_owner_acreage  ON public.reagan_mineral_ownership  (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_upton_ownership_owner_acreage   ON public.upton_mineral_ownership   (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_ward_ownership_owner_acreage    ON public.ward_mineral_ownership    (owner_name, acreage DESC NULLS LAST);
