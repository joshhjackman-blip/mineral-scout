create table if not exists public.gonzales_wells (
  api_number text primary key,
  latitude numeric,
  longitude numeric,
  operator_name text,
  well_status text,
  lease_name text,
  rrc_lease_id text,
  completion_date date,
  created_at timestamptz default now()
);

create index if not exists idx_gonzales_wells_rrc_lease_id
  on public.gonzales_wells (rrc_lease_id);

create index if not exists idx_gonzales_wells_well_status
  on public.gonzales_wells (well_status);
