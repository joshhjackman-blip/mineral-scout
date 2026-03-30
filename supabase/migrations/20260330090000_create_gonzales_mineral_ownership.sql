create extension if not exists pgcrypto;

create table if not exists public.gonzales_mineral_ownership (
  id uuid primary key default gen_random_uuid(),
  county text not null default 'Gonzales',
  county_lease_id text not null,
  county_lease_name text,
  field_name text,
  operator_name text,
  tax_year integer not null,
  cad_account_number text not null,
  cad_property_type text,
  sptb_code text,
  exemptions text,
  acreage numeric(14, 4),
  county_district_id text,
  rrc_oil_and_gas_code text,
  rrc_lease_id text,
  first_date date,
  last_date date,
  prod_cumulative_sum_gas numeric(20, 2),
  prod_cumulative_sum_oil numeric(20, 2),
  first_6_month_gas numeric(20, 2),
  first_6_month_oil numeric(20, 2),
  first_12_month_gas numeric(20, 2),
  first_12_month_oil numeric(20, 2),
  first_24_month_gas numeric(20, 2),
  first_24_month_oil numeric(20, 2),
  first_60_month_gas numeric(20, 2),
  first_60_month_oil numeric(20, 2),
  owner_name text,
  mailing_address text,
  mailing_city text,
  mailing_state text,
  mailing_zip text,
  appraised_value numeric(14, 2),
  out_of_state boolean not null default false,
  likely_motivated boolean not null default false,
  source_file text,
  raw_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (county_lease_id, cad_account_number, tax_year)
);

create index if not exists idx_gonzales_mineral_out_of_state
  on public.gonzales_mineral_ownership (out_of_state);

create index if not exists idx_gonzales_mineral_likely_motivated
  on public.gonzales_mineral_ownership (likely_motivated);

create index if not exists idx_gonzales_mineral_operator_name
  on public.gonzales_mineral_ownership (operator_name);

create index if not exists idx_gonzales_mineral_appraised_value
  on public.gonzales_mineral_ownership (appraised_value);

create or replace function public.set_gonzales_mineral_ownership_flags()
returns trigger
language plpgsql
as $$
declare
  normalized_state text;
  address_upper text;
begin
  normalized_state := upper(coalesce(trim(new.mailing_state), ''));
  address_upper := upper(coalesce(new.mailing_address, ''));

  if normalized_state <> '' then
    new.out_of_state := normalized_state not in ('TX', 'TEXAS');
  elsif address_upper <> '' then
    -- If mailing address does not clearly include TX/TEXAS, treat as out-of-state.
    new.out_of_state := address_upper !~ '(^|[^A-Z])(TX|TEXAS)([^A-Z]|$)';
  else
    new.out_of_state := false;
  end if;

  new.likely_motivated :=
    new.out_of_state
    and new.appraised_value is not null
    and new.appraised_value < 50000;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_gonzales_mineral_ownership_flags
  on public.gonzales_mineral_ownership;

create trigger trg_set_gonzales_mineral_ownership_flags
before insert or update on public.gonzales_mineral_ownership
for each row
execute procedure public.set_gonzales_mineral_ownership_flags();
