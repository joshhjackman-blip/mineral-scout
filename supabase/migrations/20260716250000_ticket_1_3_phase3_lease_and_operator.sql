-- Ticket 1.3 Phase 3 — leasing + operator-agent signal tables.
--
-- Two new tables that feed public.tract_development_status:
--
--   * lease_memoranda      — one row per newly-recorded lease memo
--                            from a county recorder scrape or manual
--                            CSV drop-in. Populated by
--                            scripts/load_lease_memoranda.py.
--
--   * operator_dev_programs — one row per (operator × county × field)
--                             that the quarterly Claude operator agent
--                             has flagged as an active development
--                             program. Populated by
--                             scripts/agent_operator_dev_programs.py.
--
-- Both are consumed by scripts/compute_development_status.py:
--   * A fresh lease memo (< 24 months old) contributes +1 pud_score
--     and can flip a tract's status to LEASING_ACTIVE when no other
--     signal outranks it.
--   * An operator tagged as active-development contributes +1 pud_score
--     to every tract that has a permit whose operator matches.

CREATE TABLE IF NOT EXISTS public.lease_memoranda (
  id BIGSERIAL PRIMARY KEY,
  county_id       TEXT NOT NULL,
  abstract_number TEXT NOT NULL,   -- normalized bare abstract ('543', not 'A-543')
  lessor          TEXT,
  lessee          TEXT,
  memo_date       DATE,            -- date of the lease itself
  filed_date      DATE,            -- date the memo was recorded at the county
  bonus_per_acre  NUMERIC,
  royalty         NUMERIC,         -- 0.20 = 20%
  primary_term_months INTEGER,
  document_id     TEXT,            -- clerk instrument / doc number
  source_url      TEXT,            -- link back to the recorder image if we have one
  source          TEXT NOT NULL DEFAULT 'manual',
  raw_record      JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lease_memoranda_county_abstract
  ON public.lease_memoranda (county_id, abstract_number);
CREATE INDEX IF NOT EXISTS idx_lease_memoranda_memo_date
  ON public.lease_memoranda (memo_date DESC);
CREATE INDEX IF NOT EXISTS idx_lease_memoranda_filed_date
  ON public.lease_memoranda (filed_date DESC);

ALTER TABLE public.lease_memoranda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all lease_memoranda" ON public.lease_memoranda;
CREATE POLICY "allow all lease_memoranda"
  ON public.lease_memoranda
  FOR ALL
  USING (true)
  WITH CHECK (true);


CREATE TABLE IF NOT EXISTS public.operator_dev_programs (
  id BIGSERIAL PRIMARY KEY,
  operator_name   TEXT NOT NULL,
  county_id       TEXT NOT NULL,
  field_name      TEXT,
  program_start   DATE,
  program_notes   TEXT,            -- free-form summary the agent produced
  source_urls     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- citations
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  cited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (operator_name, county_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_operator_dev_programs_lookup
  ON public.operator_dev_programs (county_id, active, operator_name);

ALTER TABLE public.operator_dev_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all operator_dev_programs" ON public.operator_dev_programs;
CREATE POLICY "allow all operator_dev_programs"
  ON public.operator_dev_programs
  FOR ALL
  USING (true)
  WITH CHECK (true);
