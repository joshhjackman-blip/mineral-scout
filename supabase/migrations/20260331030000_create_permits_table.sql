CREATE TABLE IF NOT EXISTS public.gonzales_permits (
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

ALTER TABLE public.gonzales_permits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all permits" ON public.gonzales_permits;
CREATE POLICY "allow all permits" ON public.gonzales_permits FOR ALL USING (true);
