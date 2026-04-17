CREATE INDEX IF NOT EXISTS idx_gonzales_ownership_owner_name
ON gonzales_mineral_ownership USING gin(to_tsvector('english', owner_name));

CREATE INDEX IF NOT EXISTS idx_gonzales_ownership_owner_name_lower
ON gonzales_mineral_ownership (lower(owner_name));
