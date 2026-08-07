-- Paste into Supabase SQL Editor if permit-page expand shows
-- "No owners recorded" despite CAD data existing for that abstract.
-- Same as supabase/migrations/20260807150000_index_howard_martin_abstract.sql

CREATE INDEX IF NOT EXISTS idx_howard_ownership_abstract
  ON public.howard_mineral_ownership (abstract);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_abstract
  ON public.martin_mineral_ownership (abstract);
