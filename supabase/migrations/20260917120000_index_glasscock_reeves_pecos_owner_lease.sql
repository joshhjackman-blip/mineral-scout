-- Glasscock / Reeves / Pecos owner-name and lease lookups time out in
-- OwnerDrawer. The CRM then shows "No matching rows found" even when
-- the row is on the roll (e.g. ROSE MELINDA ANNE / lease 41953).
--
-- CREATE TABLE … LIKE howard INCLUDING ALL does not reliably leave
-- usable owner_name / abstract / rrc_lease_id indexes on the new
-- tables (copied index names collide or the planner never picks them
-- up after the bulk load). These names are unique to this migration.
--
-- Safe to re-run (IF NOT EXISTS). Run in the Supabase SQL editor if
-- the migration runner is not wired for this project.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Glasscock
CREATE INDEX IF NOT EXISTS idx_glasscock_mo_abstract
  ON public.glasscock_mineral_ownership (abstract);
CREATE INDEX IF NOT EXISTS idx_glasscock_mo_owner_name
  ON public.glasscock_mineral_ownership (owner_name);
CREATE INDEX IF NOT EXISTS idx_glasscock_mo_owner_name_trgm
  ON public.glasscock_mineral_ownership USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_glasscock_mo_owner_acreage
  ON public.glasscock_mineral_ownership (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_glasscock_mo_rrc_lease_id
  ON public.glasscock_mineral_ownership (rrc_lease_id);

-- Reeves
CREATE INDEX IF NOT EXISTS idx_reeves_mo_abstract
  ON public.reeves_mineral_ownership (abstract);
CREATE INDEX IF NOT EXISTS idx_reeves_mo_owner_name
  ON public.reeves_mineral_ownership (owner_name);
CREATE INDEX IF NOT EXISTS idx_reeves_mo_owner_name_trgm
  ON public.reeves_mineral_ownership USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_reeves_mo_owner_acreage
  ON public.reeves_mineral_ownership (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_reeves_mo_rrc_lease_id
  ON public.reeves_mineral_ownership (rrc_lease_id);

-- Pecos
CREATE INDEX IF NOT EXISTS idx_pecos_mo_abstract
  ON public.pecos_mineral_ownership (abstract);
CREATE INDEX IF NOT EXISTS idx_pecos_mo_owner_name
  ON public.pecos_mineral_ownership (owner_name);
CREATE INDEX IF NOT EXISTS idx_pecos_mo_owner_name_trgm
  ON public.pecos_mineral_ownership USING gin (owner_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pecos_mo_owner_acreage
  ON public.pecos_mineral_ownership (owner_name, acreage DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pecos_mo_rrc_lease_id
  ON public.pecos_mineral_ownership (rrc_lease_id);

ANALYZE public.glasscock_mineral_ownership;
ANALYZE public.reeves_mineral_ownership;
ANALYZE public.pecos_mineral_ownership;
