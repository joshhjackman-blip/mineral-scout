-- Tenant isolation for CRM / notes / overrides, with SHARED skip-trace cache.
--
-- Product rule (2026-08-11):
--   • deals, owner_notes, owner_overrides → scoped to a workspace
--     (team_owner_id). Solo users are their own workspace.
--   • skip_trace_cache → shared across ALL workspaces so Mineral Map
--     only pays the skip-trace provider once per owner name. Any team
--     that later skip-traces the same owner gets a cache hit.
--   • skip_trace_usage → still per-user (for accounting); optional
--     team_owner_id for rollups.

-- ── Workspace helper (JWT metadata → subscription → self) ───────────────

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'team_owner_id', '')::uuid,
    (
      SELECT s.team_owner_id
      FROM public.subscriptions s
      WHERE s.user_id = auth.uid()
        AND s.team_owner_id IS NOT NULL
      LIMIT 1
    ),
    auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.current_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO service_role;

-- ── deals (CRM pipeline) ──────────────────────────────────────────────────

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES auth.users(id);

-- Prefer existing user_id; otherwise park legacy rows under the platform
-- owner so they don't leak into every new customer's CRM.
UPDATE public.deals
SET team_owner_id = COALESCE(
  team_owner_id,
  user_id,
  (SELECT id FROM auth.users WHERE lower(email) = 'management@mineralmapllc.com' LIMIT 1)
)
WHERE team_owner_id IS NULL;

UPDATE public.deals
SET user_id = COALESCE(user_id, team_owner_id)
WHERE user_id IS NULL AND team_owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deals_team_owner
  ON public.deals (team_owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_team_owner_name
  ON public.deals (team_owner_id, owner_name);

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deals_team_all" ON public.deals;
DROP POLICY IF EXISTS "allow all deals" ON public.deals;
DROP POLICY IF EXISTS "Enable all access for deals" ON public.deals;

CREATE POLICY "deals_team_all"
  ON public.deals
  FOR ALL
  TO authenticated
  USING (team_owner_id = public.current_workspace_id())
  WITH CHECK (team_owner_id = public.current_workspace_id());

-- ── owner_notes ───────────────────────────────────────────────────────────

ALTER TABLE public.owner_notes
  ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES auth.users(id);

UPDATE public.owner_notes
SET team_owner_id = COALESCE(
  team_owner_id,
  (SELECT id FROM auth.users WHERE lower(email) = 'management@mineralmapllc.com' LIMIT 1)
)
WHERE team_owner_id IS NULL;

-- Drop the old global unique key (name varies by how Postgres named it).
ALTER TABLE public.owner_notes
  DROP CONSTRAINT IF EXISTS owner_notes_county_id_owner_name_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.owner_notes'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%county_id%owner_name%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%team_owner_id%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.owner_notes DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'public.owner_notes'::regclass
        AND contype = 'u'
        AND pg_get_constraintdef(oid) ILIKE '%county_id%owner_name%'
        AND pg_get_constraintdef(oid) NOT ILIKE '%team_owner_id%'
      LIMIT 1
    );
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.owner_notes
    ADD CONSTRAINT owner_notes_team_county_owner_key
    UNIQUE (team_owner_id, county_id, owner_name);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_owner_notes_team_lookup
  ON public.owner_notes (team_owner_id, county_id, owner_name);

ALTER TABLE public.owner_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all owner_notes" ON public.owner_notes;
DROP POLICY IF EXISTS "owner_notes_team_all" ON public.owner_notes;

CREATE POLICY "owner_notes_team_all"
  ON public.owner_notes
  FOR ALL
  TO authenticated
  USING (team_owner_id = public.current_workspace_id())
  WITH CHECK (team_owner_id = public.current_workspace_id());

-- ── owner_overrides ───────────────────────────────────────────────────────

ALTER TABLE public.owner_overrides
  ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES auth.users(id);

UPDATE public.owner_overrides
SET team_owner_id = COALESCE(
  team_owner_id,
  (SELECT id FROM auth.users WHERE lower(email) = 'management@mineralmapllc.com' LIMIT 1)
)
WHERE team_owner_id IS NULL;

ALTER TABLE public.owner_overrides
  DROP CONSTRAINT IF EXISTS owner_overrides_county_id_owner_name_abstract_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.owner_overrides'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) ILIKE '%county_id%owner_name%abstract%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%team_owner_id%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE public.owner_overrides DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'public.owner_overrides'::regclass
        AND contype = 'u'
        AND pg_get_constraintdef(oid) ILIKE '%county_id%owner_name%abstract%'
        AND pg_get_constraintdef(oid) NOT ILIKE '%team_owner_id%'
      LIMIT 1
    );
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.owner_overrides
    ADD CONSTRAINT owner_overrides_team_county_owner_abs_key
    UNIQUE (team_owner_id, county_id, owner_name, abstract);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_owner_overrides_team_lookup
  ON public.owner_overrides (team_owner_id, county_id, owner_name);

ALTER TABLE public.owner_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all owner_overrides" ON public.owner_overrides;
DROP POLICY IF EXISTS "owner_overrides_team_all" ON public.owner_overrides;

CREATE POLICY "owner_overrides_team_all"
  ON public.owner_overrides
  FOR ALL
  TO authenticated
  USING (team_owner_id = public.current_workspace_id())
  WITH CHECK (team_owner_id = public.current_workspace_id());

-- ── skip_trace_cache (SHARED across every workspace) ──────────────────────

CREATE TABLE IF NOT EXISTS public.skip_trace_cache (
  owner_name TEXT PRIMARY KEY,
  mailing_address TEXT,
  phones TEXT[] DEFAULT '{}',
  emails TEXT[] DEFAULT '{}',
  source TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Collapse case variants so Team A / Team B share one row per owner.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY upper(trim(owner_name))
      ORDER BY updated_at DESC NULLS LAST
    ) AS rn
  FROM public.skip_trace_cache
)
DELETE FROM public.skip_trace_cache s
USING ranked r
WHERE s.ctid = r.ctid
  AND r.rn > 1;

UPDATE public.skip_trace_cache
SET owner_name = upper(trim(owner_name))
WHERE owner_name IS DISTINCT FROM upper(trim(owner_name));

ALTER TABLE public.skip_trace_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all skip_trace_cache" ON public.skip_trace_cache;
DROP POLICY IF EXISTS "skip_trace_cache_select_authenticated" ON public.skip_trace_cache;
DROP POLICY IF EXISTS "skip_trace_cache_all" ON public.skip_trace_cache;

-- Any logged-in customer can READ shared contacts (so permits/CRM can
-- show a prior team's skip-trace without re-billing the provider).
-- Writes go through the service-role skiptrace API only.
CREATE POLICY "skip_trace_cache_select_authenticated"
  ON public.skip_trace_cache
  FOR SELECT
  TO authenticated
  USING (true);

-- ── skip_trace_usage (per-user accounting; not shared) ────────────────────

CREATE TABLE IF NOT EXISTS public.skip_trace_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id),
  month TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, month)
);

ALTER TABLE public.skip_trace_usage
  ADD COLUMN IF NOT EXISTS team_owner_id UUID REFERENCES auth.users(id);

ALTER TABLE public.skip_trace_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all skip_trace_usage" ON public.skip_trace_usage;
DROP POLICY IF EXISTS "skip_trace_usage_select_own" ON public.skip_trace_usage;

CREATE POLICY "skip_trace_usage_select_own"
  ON public.skip_trace_usage
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
