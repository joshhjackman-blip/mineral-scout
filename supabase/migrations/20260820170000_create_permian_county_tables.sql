-- Mineral ownership + wells tables for five new Permian counties:
-- Loving, Midland, Reagan, Upton, Ward.
--
-- Same pattern as 20260525000000_create_martin_tables.sql: mirror Howard's
-- existing tables via `CREATE TABLE ... (LIKE ... INCLUDING ALL)` so columns,
-- defaults, checks, indexes, and the int `id` sequence match exactly. Run
-- against the Supabase project that already has howard_mineral_ownership /
-- howard_wells. Idempotent (`if not exists`).

-- Loving (FIPS 48301)
create table if not exists public.loving_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.loving_wells
  (like public.howard_wells including all);

-- Midland (FIPS 48329)
create table if not exists public.midland_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.midland_wells
  (like public.howard_wells including all);

-- Reagan (FIPS 48383)
create table if not exists public.reagan_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.reagan_wells
  (like public.howard_wells including all);

-- Upton (FIPS 48461)
create table if not exists public.upton_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.upton_wells
  (like public.howard_wells including all);

-- Ward (FIPS 48475)
create table if not exists public.ward_mineral_ownership
  (like public.howard_mineral_ownership including all);
create table if not exists public.ward_wells
  (like public.howard_wells including all);

-- Permits tables (mirror howard_permits) so the daily RRC permit scraper
-- and the /permits page have a target for each county.
create table if not exists public.midland_permits
  (like public.howard_permits including all);
create table if not exists public.loving_permits
  (like public.howard_permits including all);
create table if not exists public.reagan_permits
  (like public.howard_permits including all);
create table if not exists public.upton_permits
  (like public.howard_permits including all);
create table if not exists public.ward_permits
  (like public.howard_permits including all);
