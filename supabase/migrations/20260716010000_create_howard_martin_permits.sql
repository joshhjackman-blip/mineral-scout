-- Mirror of gonzales_permits (see 20260331030000_create_permits_table.sql) for
-- Howard and Martin. Each county gets its own table so we stay consistent with
-- the per-county pattern used by <county>_wells and <county>_mineral_ownership.
--
-- The <county>_permits shape is intentionally loose — it holds "recent
-- permits and newly-completed wells" for the map's blue permit-dot layer and
-- for the parcels-level new_permit / pending_permit classification written by
-- scripts/add_production_status.py. The `status` field carries either an RRC
-- well status (PRODUCING / SHUT IN / NO PRODUCTION — matches Gonzales's
-- current data) or a real permit status (PENDING / APPROVED) depending on the
-- upstream source; the parcels tagger accepts both.

CREATE TABLE IF NOT EXISTS public.howard_permits (
  id SERIAL PRIMARY KEY,
  permit_number TEXT,
  api_number TEXT,
  operator_name TEXT,
  lease_name TEXT,
  county_code TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  permit_type TEXT,
  status TEXT,
  filed_date TEXT,
  approved_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.howard_permits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all permits" ON public.howard_permits;
CREATE POLICY "allow all permits" ON public.howard_permits FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_howard_permits_api_number
  ON public.howard_permits (api_number);
CREATE INDEX IF NOT EXISTS idx_howard_permits_operator_name
  ON public.howard_permits (operator_name);

CREATE TABLE IF NOT EXISTS public.martin_permits (
  id SERIAL PRIMARY KEY,
  permit_number TEXT,
  api_number TEXT,
  operator_name TEXT,
  lease_name TEXT,
  county_code TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  permit_type TEXT,
  status TEXT,
  filed_date TEXT,
  approved_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.martin_permits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all permits" ON public.martin_permits;
CREATE POLICY "allow all permits" ON public.martin_permits FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_martin_permits_api_number
  ON public.martin_permits (api_number);
CREATE INDEX IF NOT EXISTS idx_martin_permits_operator_name
  ON public.martin_permits (operator_name);
