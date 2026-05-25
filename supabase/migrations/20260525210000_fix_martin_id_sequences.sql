-- Give Martin its own id sequences.
--
-- ``CREATE TABLE martin_* (LIKE howard_* INCLUDING ALL)`` (migration
-- 20260525000000) copied Howard's column DEFAULT clause verbatim, which
-- references ``howard_mineral_ownership_id_seq`` / ``howard_wells_id_seq``.
-- Martin inserts have therefore been consuming Howard's sequences,
-- inflating Howard's id range without inserting Howard rows.
--
-- This migration:
--   1. Creates martin_mineral_ownership_id_seq + martin_wells_id_seq.
--   2. Repoints each Martin id column at its own sequence.
--   3. Sets the new sequences past Martin's current max id so future
--      inserts don't collide with existing rows.
--   4. Rewinds Howard's sequences back to Howard's actual max+1 so
--      future Howard inserts pick up where they left off (215,593 and
--      34,925 respectively as of this migration).

-- 1. Create new sequences.
create sequence if not exists public.martin_mineral_ownership_id_seq;
create sequence if not exists public.martin_wells_id_seq;

-- 2. Repoint defaults.
alter table public.martin_mineral_ownership
  alter column id set default nextval('public.martin_mineral_ownership_id_seq');
alter table public.martin_wells
  alter column id set default nextval('public.martin_wells_id_seq');

-- 3. Bind sequences to columns so they're dropped together.
alter sequence public.martin_mineral_ownership_id_seq
  owned by public.martin_mineral_ownership.id;
alter sequence public.martin_wells_id_seq
  owned by public.martin_wells.id;

-- 4. Advance Martin sequences past existing data.
select setval(
  'public.martin_mineral_ownership_id_seq',
  coalesce((select max(id) from public.martin_mineral_ownership), 0) + 1,
  false
);
select setval(
  'public.martin_wells_id_seq',
  coalesce((select max(id) from public.martin_wells), 0) + 1,
  false
);

-- 5. Rewind Howard sequences to Howard's actual max so future Howard
--    inserts use dense ids (the Martin load left big gaps in Howard's
--    sequences without writing any Howard rows).
select setval(
  'public.howard_mineral_ownership_id_seq',
  coalesce((select max(id) from public.howard_mineral_ownership), 0)
);
select setval(
  'public.howard_wells_id_seq',
  coalesce((select max(id) from public.howard_wells), 0)
);
