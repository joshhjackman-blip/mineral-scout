-- Public owner search reads these tables with the anon/publishable key.
-- CREATE TABLE does not grant SELECT to anon/authenticated.

grant select on
  public.glasscock_mineral_ownership,
  public.glasscock_wells,
  public.reeves_mineral_ownership,
  public.reeves_wells,
  public.pecos_mineral_ownership,
  public.pecos_wells
to anon, authenticated;
