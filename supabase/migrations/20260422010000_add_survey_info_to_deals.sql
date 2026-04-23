-- Add survey / block / section metadata to CRM deals so the PSA generator can
-- build a proper legal description without needing the map context.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS surv_name TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS block TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS surv_sect TEXT;
