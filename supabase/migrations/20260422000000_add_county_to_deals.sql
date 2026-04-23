-- Add optional county label to CRM deals so the pipeline can filter by county.
-- Kept nullable so existing rows don't need a default backfill — the app
-- derives the county at render time from operator_name / tract_abstract when
-- this column is NULL.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS county TEXT;

CREATE INDEX IF NOT EXISTS idx_deals_county ON deals (county);
