CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_gonzales_ownership_owner_name_trgm
ON public.gonzales_mineral_ownership
USING gin (owner_name gin_trgm_ops);
