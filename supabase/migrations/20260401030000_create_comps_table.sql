CREATE TABLE IF NOT EXISTS public.comps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  close_date DATE,
  operator_name TEXT,
  acreage NUMERIC,
  nri NUMERIC,
  monthly_royalty NUMERIC,
  sale_price NUMERIC,
  price_per_nri_acre NUMERIC,
  royalty_multiple NUMERIC,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.comps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all comps" ON public.comps;
CREATE POLICY "allow all comps" ON public.comps FOR ALL USING (true);
