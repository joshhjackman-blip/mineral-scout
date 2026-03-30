alter table public.gonzales_mineral_ownership
add column if not exists propensity_score integer default 0,
add column if not exists decline_rate numeric default 0,
add column if not exists motivated boolean default false;

update public.gonzales_mineral_ownership
set propensity_score = (
  case when mailing_state != 'TX' and mailing_state is not null then 3 else 0 end +
  case when upper(owner_name) like '%ESTATE%' or upper(owner_name) like '%TRUST%' then 2 else 0 end +
  case when upper(owner_name) like '%LLC%' or upper(owner_name) like '%LP%' or upper(owner_name) like '%CORP%' then 1 else 0 end +
  case when acreage < 50 then 1 else 0 end +
  case when prod_cumulative_sum_oil > 0 then 1 else 0 end
);

update public.gonzales_mineral_ownership
set motivated = (propensity_score >= 4);
