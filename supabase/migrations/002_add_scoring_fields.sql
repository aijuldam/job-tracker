-- Scoring explanation from Claude
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS reasoning TEXT;

-- Distinguish Adzuna-provided salary (false) from Claude-estimated salary (true)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS salary_is_estimated BOOLEAN NOT NULL DEFAULT false;

-- User-set date when they applied for this role
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS date_applied DATE;
