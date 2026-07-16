-- Ticket 1.3 (expanded) — PUD / Development-Status Tracking
-- ==========================================================
-- Phase 1A + 1C data layer. See legal/ticket-1.3-pud-tracking-spec.md
-- or the source PDF for the full spec.
--
-- Two moves in this migration:
--   1. Extend every <county>_permits table with the new columns the
--      W-1 / DUC pipeline reads (spud_date, completion_date, survey_name,
--      abstract_number, lateral_length_ft, permit_status).
--   2. Create the county-scoped tract_development_status table that
--      scripts/compute_development_status.py upserts into nightly.
--
-- Deviation from the spec: spec uses `abstract_number PRIMARY KEY`,
-- which would collide across counties (Howard A-543 ≠ Martin A-543).
-- We use a composite key (county_id, abstract_number) so a single
-- table serves every county on the platform.

-- --------------------------------------------------------------
-- 1. Extend every <county>_permits table
-- --------------------------------------------------------------

DO $$
DECLARE
  county text;
  counties text[] := ARRAY[
    'gonzales', 'howard', 'martin',
    'crane', 'glasscock', 'loving', 'midland', 'pecos',
    'reagan', 'reeves', 'upton', 'ward', 'winkler'
  ];
BEGIN
  FOREACH county IN ARRAY counties LOOP
    -- Skip counties whose permits table doesn't exist yet (e.g. a
    -- Permian county created but not yet enabled). Otherwise the
    -- FOREACH would blow up mid-loop.
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = county || '_permits'
    ) THEN
      RAISE NOTICE 'Skipping %_permits: table does not exist yet', county;
      CONTINUE;
    END IF;

    EXECUTE format($ddl$
      ALTER TABLE public.%I
        ADD COLUMN IF NOT EXISTS permit_status TEXT,
        ADD COLUMN IF NOT EXISTS spud_date TEXT,
        ADD COLUMN IF NOT EXISTS completion_date TEXT,
        ADD COLUMN IF NOT EXISTS survey_name TEXT,
        ADD COLUMN IF NOT EXISTS abstract_number TEXT,
        ADD COLUMN IF NOT EXISTS lateral_length_ft INTEGER;
    $ddl$, county || '_permits');

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (abstract_number);',
      'idx_' || county || '_permits_abstract_number',
      county || '_permits'
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (permit_status);',
      'idx_' || county || '_permits_permit_status',
      county || '_permits'
    );
  END LOOP;
END $$;

-- --------------------------------------------------------------
-- 2. tract_development_status
-- --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tract_development_status (
  county_id       TEXT NOT NULL,
  abstract_number TEXT NOT NULL,
  -- One of: PDP | PUD_DUC | PUD_PERMITTED | PUD_INFILL | LEASING_ACTIVE | FRONTIER
  development_status TEXT NOT NULL DEFAULT 'FRONTIER',
  pud_score       INTEGER NOT NULL DEFAULT 0 CHECK (pud_score BETWEEN 0 AND 10),
  -- Signal breakdown for the "Why this status?" tract-panel dropdown.
  -- Expected shape:
  --   {
  --     "permits":   [{ "permit_number": "...", "operator": "...", "status": "approved", "approved_date": "2024-08-14" }],
  --     "ducs":      [{ "api": "...", "spud_date": "...", "operator": "..." }],
  --     "adjacent_permits": [{ "adjacent_abstract": "A-542", "count": 3 }],
  --     "infill_gaps": 0,
  --     "leases":    []
  --   }
  signal_detail   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_computed   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (county_id, abstract_number)
);

CREATE INDEX IF NOT EXISTS idx_tract_dev_status_lookup
  ON public.tract_development_status
  (county_id, development_status, pud_score DESC);

CREATE INDEX IF NOT EXISTS idx_tract_dev_status_score
  ON public.tract_development_status (pud_score DESC);

ALTER TABLE public.tract_development_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all tract_development_status" ON public.tract_development_status;
CREATE POLICY "allow all tract_development_status"
  ON public.tract_development_status
  FOR ALL
  USING (true)
  WITH CHECK (true);
