create index if not exists idx_gonzales_ownership_propensity
on public.gonzales_mineral_ownership (propensity_score desc);

create index if not exists idx_gonzales_ownership_motivated
on public.gonzales_mineral_ownership (motivated);

create index if not exists idx_gonzales_ownership_lease
on public.gonzales_mineral_ownership (rrc_lease_id);

create index if not exists idx_gonzales_wells_lease
on public.gonzales_wells (rrc_lease_id);
