-- Owner-level notes surfaced in the OwnerDrawer's Notes tab.
--
-- The CRM's per-deal notes live on public.deals.notes and only exist for
-- owners who have been explicitly added to the pipeline. This table lets
-- users take notes on any mineral owner (whether or not they're in the
-- pipeline yet) so a call-prep drawer can persist context on the fly.
--
-- One row per (county_id, owner_name); autosave upserts on blur.

CREATE TABLE IF NOT EXISTS public.owner_notes (
  id BIGSERIAL PRIMARY KEY,
  county_id TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (county_id, owner_name)
);

CREATE INDEX IF NOT EXISTS idx_owner_notes_owner_lookup
  ON public.owner_notes (county_id, owner_name);

ALTER TABLE public.owner_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all owner_notes" ON public.owner_notes;
CREATE POLICY "allow all owner_notes"
  ON public.owner_notes
  FOR ALL
  USING (true)
  WITH CHECK (true);
