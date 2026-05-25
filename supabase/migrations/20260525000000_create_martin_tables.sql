-- Martin County mineral ownership + wells.
--
-- Mirrors the Howard County deployment (whose tables were created outside
-- the migrations folder during initial bring-up). Schemas reflect the
-- columns produced by scripts/load_county_mineral_records.py and
-- scripts/load_county_wells_shapefile.py.

create extension if not exists pgcrypto;

create table if not exists public.martin_mineral_ownership (
  id uuid primary key default gen_random_uuid(),
  county text not null default 'Martin',
  source_key text,
  owner_id text,
  owner_name text,
  address_1 text,
  address_2 text,
  address_3 text,
  address_4 text,
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  well text,
  county_lease_name text,
  year_began integer,
  rrc_lease_id text,
  rrc_oil_and_gas_code text,
  operator_name text,
  field_name text,
  zone text,
  survey text,
  abstract text,
  block text,
  section text,
  extra text,
  acreage numeric(14, 4),
  cad_property_type text,
  ownership_pct numeric(20, 12),
  appraised_value numeric(14, 2),
  tax_year integer,
  appraisal_code text,
  search_id text,
  search_index text,
  bid_amount numeric(14, 2),
  add_date date,
  lease_state text,
  matching_flag text,
  matching_flag_2 text,
  latitude numeric,
  longitude numeric,
  api text,
  lease_unique text,
  class_type text,
  value_aop numeric,
  wells_in_lease integer,
  bbd_acres numeric,
  acres_per_well numeric,
  lease_boe_reserves numeric,
  net_boe_reserves numeric,
  value_reserves numeric,
  first_date date,
  last_date date,
  prod_cumulative_sum_oil numeric,
  prod_cumulative_sum_gas numeric,
  first_6_month_oil numeric,
  first_12_month_oil numeric,
  first_24_month_oil numeric,
  first_60_month_oil numeric,
  first_6_month_gas numeric,
  first_12_month_gas numeric,
  first_24_month_gas numeric,
  first_60_month_gas numeric,
  propensity_score integer not null default 0,
  motivated boolean not null default false,
  out_of_state boolean not null default false,
  raw_record jsonb not null default '{}'::jsonb,
  source_file text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Source files include a per-row primary key (``_key``) that uniquely
  -- identifies an owner x interest type x lease record. Use it as the
  -- upsert target so we don't collapse the multiple RI/WI/ORRI rows a
  -- single owner can hold against the same well in the same tax year.
  unique (source_key)
);

create index if not exists idx_martin_ownership_abstract
  on public.martin_mineral_ownership (abstract);

create index if not exists idx_martin_ownership_owner_name
  on public.martin_mineral_ownership (owner_name);

create index if not exists idx_martin_ownership_propensity
  on public.martin_mineral_ownership (propensity_score desc);

create index if not exists idx_martin_ownership_motivated
  on public.martin_mineral_ownership (motivated);

create index if not exists idx_martin_ownership_out_of_state
  on public.martin_mineral_ownership (out_of_state);

create index if not exists idx_martin_ownership_operator_name
  on public.martin_mineral_ownership (operator_name);

create index if not exists idx_martin_ownership_rrc_lease_id
  on public.martin_mineral_ownership (rrc_lease_id);

create index if not exists idx_martin_ownership_appraised_value
  on public.martin_mineral_ownership (appraised_value);

create or replace function public.set_martin_mineral_ownership_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_martin_mineral_ownership_updated_at
  on public.martin_mineral_ownership;

create trigger trg_set_martin_mineral_ownership_updated_at
before update on public.martin_mineral_ownership
for each row
execute procedure public.set_martin_mineral_ownership_updated_at();

create table if not exists public.martin_wells (
  api text primary key,
  api10 text,
  well_id text,
  surface_id text,
  bottom_id text,
  latitude numeric,
  longitude numeric,
  bottom_latitude numeric,
  bottom_longitude numeric,
  st_code text,
  well_type text,
  well_status text,
  lateral_length numeric,
  abstract text,
  lease_name text,
  operator_name text,
  rrc_lease_id text,
  oil_gas_code text,
  completion_date date,
  created_at timestamptz not null default now()
);

create index if not exists idx_martin_wells_abstract
  on public.martin_wells (abstract);

create index if not exists idx_martin_wells_rrc_lease_id
  on public.martin_wells (rrc_lease_id);

create index if not exists idx_martin_wells_operator_name
  on public.martin_wells (operator_name);

create index if not exists idx_martin_wells_well_status
  on public.martin_wells (well_status);
