-- Speeds permit-page / wells-API lookups:
--   .in('abstract', ['616', 'A-616']) against mineral_ownership
-- Without this index Martin/Howard abstract filters seq-scan and can
-- hit statement_timeout — the UI then shows "No owners recorded".

CREATE INDEX IF NOT EXISTS idx_howard_ownership_abstract
  ON public.howard_mineral_ownership (abstract);

CREATE INDEX IF NOT EXISTS idx_martin_ownership_abstract
  ON public.martin_mineral_ownership (abstract);
