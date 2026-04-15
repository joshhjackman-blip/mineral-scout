CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.oklahoma_mineral_deeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county TEXT NOT NULL,
  state TEXT DEFAULT 'OK',
  section TEXT,
  township TEXT,
  range TEXT,
  grantor TEXT,
  grantee TEXT,
  interest NUMERIC,
  legal_desc TEXT,
  recorded_date TEXT,
  instrument_type TEXT,
  confidence NUMERIC,
  needs_review BOOLEAN DEFAULT false,
  reviewed BOOLEAN DEFAULT false,
  reviewer_action TEXT,
  raw_text TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.oklahoma_mineral_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county TEXT NOT NULL,
  state TEXT DEFAULT 'OK',
  section TEXT,
  township TEXT,
  range TEXT,
  owner_name TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  decimal_interest NUMERIC,
  chain_confidence NUMERIC,
  needs_review BOOLEAN DEFAULT false,
  propensity_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.oklahoma_research_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county TEXT NOT NULL,
  section TEXT,
  township TEXT,
  range TEXT,
  status TEXT DEFAULT 'pending',
  deeds_found INTEGER DEFAULT 0,
  needs_review_count INTEGER DEFAULT 0,
  agent_session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(county, section, township, range)
);
