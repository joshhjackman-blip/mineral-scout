-- Per-user working-list corrections for mineral owners.
--
-- CAD *_mineral_ownership rows stay read-only. Landmen can:
--   - update contact / display name (status = 'updated')
--   - hide a wrong/deceased/sold owner from their tract list
--     (status = 'hidden' | 'incorrect')
--
-- Identity key is the CAD owner_name (plus county + optional abstract).
-- abstract = '' means the override applies across every tract in the county.

CREATE TABLE IF NOT EXISTS public.owner_overrides (
  id BIGSERIAL PRIMARY KEY,
  county_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  abstract TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'updated'
    CHECK (status IN ('updated', 'hidden', 'incorrect')),
  display_name TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  phone TEXT,
  email TEXT,
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (county_id, owner_name, abstract)
);

CREATE INDEX IF NOT EXISTS idx_owner_overrides_lookup
  ON public.owner_overrides (county_id, owner_name);

CREATE INDEX IF NOT EXISTS idx_owner_overrides_county_status
  ON public.owner_overrides (county_id, status);

ALTER TABLE public.owner_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all owner_overrides" ON public.owner_overrides;
CREATE POLICY "allow all owner_overrides"
  ON public.owner_overrides
  FOR ALL
  USING (true)
  WITH CHECK (true);
