-- Pad activity detection (Rig → Completion crew change)
--
-- Weekly Sentinel-2 change detection feeds these tables. Phase 1 also
-- writes events from RRC permit/well completion transitions so the
-- OwnerDrawer "Well Activity" card has real signal before imagery
-- is fully wired.
--
-- Join keys mirror the rest of the app:
--   county_id + abstract_number  -> tract_development_status / map
--   rrc_lease_id / api_number    -> {county}_wells
--   county_id + owner_name       -> owner_notes / CRM deals

-- 1. Weekly chip inventory (Supabase Storage paths under Raw-Data/)
CREATE TABLE IF NOT EXISTS public.pad_imagery_log (
  id              BIGSERIAL PRIMARY KEY,
  county_id       TEXT NOT NULL,
  rrc_lease_id    TEXT,
  api_number      TEXT,
  abstract_number TEXT,
  imagery_date    DATE NOT NULL,
  cloud_cover     NUMERIC,
  storage_path    TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'sentinel-2',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pad_imagery_unique_chip
  ON public.pad_imagery_log (
    county_id,
    COALESCE(api_number, ''),
    COALESCE(rrc_lease_id, ''),
    imagery_date
  );

CREATE INDEX IF NOT EXISTS idx_pad_imagery_county_date
  ON public.pad_imagery_log (county_id, imagery_date DESC);

-- 2. Per-pad weekly change scores
CREATE TABLE IF NOT EXISTS public.pad_change_log (
  id              BIGSERIAL PRIMARY KEY,
  county_id       TEXT NOT NULL,
  rrc_lease_id    TEXT,
  api_number      TEXT,
  abstract_number TEXT,
  week_start      DATE NOT NULL,
  change_score    NUMERIC NOT NULL DEFAULT 0,
  classification  TEXT NOT NULL
    CHECK (classification IN ('NO_CHANGE', 'MINOR_CHANGE', 'MAJOR_CHANGE')),
  before_path     TEXT,
  after_path      TEXT,
  metrics         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pad_change_unique_week
  ON public.pad_change_log (
    county_id,
    COALESCE(api_number, ''),
    COALESCE(rrc_lease_id, ''),
    week_start
  );

CREATE INDEX IF NOT EXISTS idx_pad_change_major
  ON public.pad_change_log (county_id, week_start DESC)
  WHERE classification = 'MAJOR_CHANGE';

-- 3. User-facing activity events (OwnerDrawer + CRM)
CREATE TABLE IF NOT EXISTS public.pad_activity_events (
  id              BIGSERIAL PRIMARY KEY,
  county_id       TEXT NOT NULL,
  rrc_lease_id    TEXT,
  api_number      TEXT,
  abstract_number TEXT,
  owner_name      TEXT,
  lease_name      TEXT,
  operator_name   TEXT,
  -- COMPLETION_CREW | RIG_MOVE_IN | RIG_MOVE_OUT | AMBIGUOUS | NON_RELEVANT
  -- | RRC_COMPLETION (Phase 1 bridge from public filings)
  signature       TEXT NOT NULL,
  confidence      NUMERIC NOT NULL DEFAULT 0
    CHECK (confidence >= 0 AND confidence <= 1),
  change_score    NUMERIC,
  summary         TEXT NOT NULL DEFAULT '',
  before_path     TEXT,
  after_path      TEXT,
  week_start      DATE NOT NULL,
  propensity_bump INTEGER NOT NULL DEFAULT 0,
  -- sentinel_change | rrc_transition | highres_confirm
  source          TEXT NOT NULL DEFAULT 'sentinel_change',
  raw             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pad_activity_county_abstract
  ON public.pad_activity_events (county_id, abstract_number, week_start DESC);

CREATE INDEX IF NOT EXISTS idx_pad_activity_county_owner
  ON public.pad_activity_events (county_id, owner_name, week_start DESC);

CREATE INDEX IF NOT EXISTS idx_pad_activity_signature_week
  ON public.pad_activity_events (signature, week_start DESC);

ALTER TABLE public.pad_imagery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pad_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pad_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow read pad_imagery_log" ON public.pad_imagery_log;
CREATE POLICY "allow read pad_imagery_log"
  ON public.pad_imagery_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow all pad_imagery_log svc" ON public.pad_imagery_log;
CREATE POLICY "allow all pad_imagery_log svc"
  ON public.pad_imagery_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow read pad_change_log" ON public.pad_change_log;
CREATE POLICY "allow read pad_change_log"
  ON public.pad_change_log FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow all pad_change_log svc" ON public.pad_change_log;
CREATE POLICY "allow all pad_change_log svc"
  ON public.pad_change_log FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow read pad_activity_events" ON public.pad_activity_events;
CREATE POLICY "allow read pad_activity_events"
  ON public.pad_activity_events FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow all pad_activity_events svc" ON public.pad_activity_events;
CREATE POLICY "allow all pad_activity_events svc"
  ON public.pad_activity_events FOR ALL USING (true) WITH CHECK (true);
