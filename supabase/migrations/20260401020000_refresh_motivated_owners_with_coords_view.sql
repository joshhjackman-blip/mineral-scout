create or replace view public.motivated_owners_with_coords as
select
  o.owner_name,
  o.mailing_city,
  o.mailing_state,
  o.operator_name,
  o.propensity_score,
  o.motivated,
  o.out_of_state,
  o.acreage,
  o.prod_cumulative_sum_oil,
  o.rrc_lease_id,
  w.latitude,
  w.longitude,
  w.well_status
from gonzales_mineral_ownership o
join gonzales_wells w
  on trim(leading '0' from w.rrc_lease_id::text) =
     trim(leading '0' from o.rrc_lease_id::text)
where o.motivated = true
  and w.latitude is not null
  and w.longitude is not null;
