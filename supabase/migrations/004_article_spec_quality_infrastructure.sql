-- Article Spec contract, governed knowledge, website inventory, QC and editorial approvals.
CREATE TABLE IF NOT EXISTS article_specs (
  article_id TEXT PRIMARY KEY REFERENCES writer_articles(id) ON DELETE CASCADE,
  content_plan_id UUID REFERENCES content_plans(id), version INTEGER NOT NULL,
  fingerprint TEXT NOT NULL, spec JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY, source_name TEXT NOT NULL, knowledge_type TEXT NOT NULL DEFAULT 'reference',
  topics TEXT[] NOT NULL DEFAULT '{}', service TEXT, audience TEXT, visibility TEXT NOT NULL DEFAULT 'internal',
  approved_for_external_use BOOLEAN NOT NULL DEFAULT false, metadata JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS website_content_inventory (
  id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, canonical_url TEXT, title TEXT NOT NULL, content_type TEXT NOT NULL,
  topics TEXT[] NOT NULL DEFAULT '{}', services TEXT[] NOT NULL DEFAULT '{}', audience TEXT,
  status TEXT NOT NULL DEFAULT 'unchecked', redirect_target TEXT, eligible_for_internal_link BOOLEAN NOT NULL DEFAULT true,
  last_checked TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS quality_gate_runs (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES writer_articles(id) ON DELETE CASCADE,
  spec_fingerprint TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, report JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_gate_runs_article_idx ON quality_gate_runs(article_id, created_at DESC);
CREATE TABLE IF NOT EXISTS editorial_approvals (
  article_id TEXT PRIMARY KEY REFERENCES writer_articles(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending',
  outline_fingerprint TEXT, note TEXT, approved_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE article_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_content_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_gate_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE editorial_approvals ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['article_specs','knowledge_items','website_content_inventory','quality_gate_runs','editorial_approvals'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', table_name);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;
