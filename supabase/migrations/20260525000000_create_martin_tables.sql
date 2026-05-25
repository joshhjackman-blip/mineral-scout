-- Martin County mineral ownership + wells.
--
-- Mirrors Howard's existing tables exactly via `CREATE TABLE LIKE`. Howard's
-- schemas were created outside the migrations folder during initial bring-up;
-- copying them with INCLUDING ALL preserves columns, defaults, indexes, and
-- the int sequence on `id`. Run this against the Supabase project that
-- already has howard_mineral_ownership / howard_wells.

create table if not exists public.martin_mineral_ownership
  (like public.howard_mineral_ownership including all);

create table if not exists public.martin_wells
  (like public.howard_wells including all);

-- LIKE INCLUDING ALL copies the existing CHECK / DEFAULTs / INDEXES, but
-- INDEX names are auto-renamed by Postgres to avoid collisions, so we don't
-- need to do anything else here. Foreign keys (none on these tables) and
-- triggers are not copied — both Howard tables don't currently have any.
