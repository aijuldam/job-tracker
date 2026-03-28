-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
CREATE TYPE job_tab AS ENUM ('pmm', 'finance');
CREATE TYPE job_source AS ENUM ('adzuna', 'linkedin_manual', 'career_page');
CREATE TYPE job_status_type AS ENUM ('not_applied', 'applied', 'interviewing', 'offer', 'rejected');

-- Jobs table
CREATE TABLE jobs (
  id            UUID             DEFAULT gen_random_uuid() PRIMARY KEY,
  tab           job_tab          NOT NULL,
  title         TEXT             NOT NULL,
  company       TEXT             NOT NULL,
  location      TEXT,
  url           TEXT             NOT NULL,
  posted_date   DATE,
  salary_min    INTEGER,
  salary_max    INTEGER,
  source        job_source       NOT NULL DEFAULT 'adzuna',
  industry      TEXT,
  company_size  TEXT             CHECK (company_size IN ('startup', 'scale-up', 'enterprise')),
  seniority_level TEXT           CHECK (seniority_level IN ('Director', 'VP', 'Head of', 'Senior Manager')),
  match_score   INTEGER          CHECK (match_score >= 0 AND match_score <= 100),
  status        job_status_type  NOT NULL DEFAULT 'not_applied',
  notes         TEXT,
  created_at    TIMESTAMPTZ      DEFAULT NOW(),
  updated_at    TIMESTAMPTZ      DEFAULT NOW()
);

-- Unique constraint on URL for upsert deduplication
ALTER TABLE jobs ADD CONSTRAINT jobs_url_unique UNIQUE (url);

-- Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Row Level Security (anon key with "allow all" is fine for a personal app)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON jobs FOR ALL USING (true) WITH CHECK (true);

-- Indexes for common query patterns
CREATE INDEX idx_jobs_tab           ON jobs (tab);
CREATE INDEX idx_jobs_tab_score     ON jobs (tab, match_score DESC);
CREATE INDEX idx_jobs_status        ON jobs (status);
CREATE INDEX idx_jobs_posted_date   ON jobs (posted_date DESC);
