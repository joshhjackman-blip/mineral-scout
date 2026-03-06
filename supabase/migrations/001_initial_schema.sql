-- Organizations (pharmacy accounts)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link users to organizations
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API Suppliers
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  country TEXT,
  city TEXT,
  fda_registration_number TEXT,
  fda_registered BOOLEAN DEFAULT FALSE,
  primary_compounds TEXT[], -- array of compound names they supply
  risk_score INTEGER DEFAULT 0, -- 0-100
  risk_score_updated_at TIMESTAMPTZ,
  last_shipment_date DATE,
  total_shipments INTEGER DEFAULT 0,
  active_fda_actions INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- US Customs Shipment Records
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  shipper_name TEXT NOT NULL,
  consignee_name TEXT,
  arrival_date DATE,
  port_of_entry TEXT,
  country_of_origin TEXT,
  description TEXT,
  weight_kg NUMERIC,
  container_count INTEGER,
  hs_code TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FDA Enforcement Actions
CREATE TABLE fda_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL, -- 'warning_letter' | 'import_alert' | 'recall' | 'inspection'
  title TEXT,
  issue_date DATE,
  status TEXT DEFAULT 'active', -- 'active' | 'resolved' | 'closed'
  description TEXT,
  source_url TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- DEA Scheduling Alerts
CREATE TABLE scheduling_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compound_name TEXT NOT NULL,
  alert_type TEXT, -- 'scheduling_proposed' | 'scheduling_final' | 'analog_concern'
  description TEXT,
  effective_date DATE,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- COA Documents
CREATE TABLE coa_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Supabase Storage path
  compound_name TEXT,
  lot_number TEXT,
  manufacture_date DATE,
  expiry_date DATE,
  analysis_results JSONB, -- AI-extracted test results
  status TEXT DEFAULT 'pending', -- 'pending' | 'extracted' | 'verified' | 'expired'
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Watchlists
CREATE TABLE watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, supplier_id)
);

-- Enable Row Level Security on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE coa_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

-- Public read on supplier/FDA data (no RLS needed for these)
-- coa_documents and watchlist are org/user-scoped

-- RLS: Users can only see their own watchlist
CREATE POLICY "Users see own watchlist" ON watchlist
  FOR ALL USING (auth.uid() = user_id);

-- RLS: Users can only see COAs from their organization
CREATE POLICY "Org members see own COAs" ON coa_documents
  FOR ALL USING (
    org_id IN (
      SELECT org_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
