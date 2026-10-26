SET LOCAL search_path TO writer_studio, pg_catalog;
-- Writer Studio — KV Store table
-- Chạy lệnh này trong Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS kv_store (
  key   TEXT NOT NULL PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tự động cập nhật updated_at khi upsert
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('writer_studio.importing', true) = 'on' THEN RETURN NEW; END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER kv_store_updated_at
  BEFORE INSERT OR UPDATE ON kv_store
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Versioned Content Plans and queryable article/usage projections.


CREATE TABLE IF NOT EXISTS content_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','processing','ready','active','archived','failed')),
  version INTEGER NOT NULL DEFAULT 1, previous_version_id UUID REFERENCES content_plans(id),
  source_fingerprint TEXT NOT NULL DEFAULT '', classification_model TEXT, classification_prompt_version TEXT,
  change_summary JSONB,
  total_articles INTEGER NOT NULL DEFAULT 0, comparison_count INTEGER NOT NULL DEFAULT 0,
  editorial_count INTEGER NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), classified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS content_plan_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), content_plan_id UUID NOT NULL REFERENCES content_plans(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('file','google_doc','google_sheet','paste')),
  name TEXT NOT NULL, original_url TEXT, storage_path TEXT, mime_type TEXT,
  extracted_content TEXT, content_hash TEXT NOT NULL, content_length INTEGER NOT NULL DEFAULT 0,
  scan_status TEXT NOT NULL DEFAULT 'processing' CHECK (scan_status IN ('processing','ready','failed')),
  scan_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), content_plan_id UUID NOT NULL REFERENCES content_plans(id) ON DELETE CASCADE,
  source_id UUID REFERENCES content_plan_sources(id) ON DELETE SET NULL, source_section_id TEXT,
  title TEXT NOT NULL, keywords TEXT[] NOT NULL DEFAULT '{}', source_text TEXT, source_quote TEXT,
  content_group TEXT NOT NULL CHECK (content_group IN ('comparison_seo','editorial_originality','needs_review')),
  confidence NUMERIC(4,3), classification_reason TEXT, position INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS writer_articles (
  id TEXT PRIMARY KEY, content_plan_id UUID REFERENCES content_plans(id), content_plan_item_id UUID REFERENCES content_plan_items(id),
  activity_id TEXT, content_group TEXT CHECK (content_group IN ('comparison_seo','editorial_originality')),
  title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', current_step INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}', draft TEXT, batch_status TEXT, error_message TEXT,
  migrated_from_article_id TEXT REFERENCES writer_articles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS writer_articles_unique_plan_item ON writer_articles(content_plan_id, content_plan_item_id) WHERE content_plan_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS writer_articles_plan_group_idx ON writer_articles(content_plan_id, content_group);
CREATE INDEX IF NOT EXISTS writer_articles_activity_idx ON writer_articles(activity_id);
CREATE INDEX IF NOT EXISTS writer_articles_status_idx ON writer_articles(content_plan_id, status);
CREATE INDEX IF NOT EXISTS content_plan_items_plan_group_idx ON content_plan_items(content_plan_id, content_group);

CREATE TABLE IF NOT EXISTS writer_ai_usage (
  id TEXT PRIMARY KEY, content_plan_id UUID REFERENCES content_plans(id), activity_id TEXT,
  article_id TEXT REFERENCES writer_articles(id) ON DELETE CASCADE, step INTEGER NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0, cost_usd NUMERIC(12,6), cache_hit BOOLEAN NOT NULL DEFAULT false,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS writer_ai_usage_plan_idx ON writer_ai_usage(content_plan_id);
CREATE INDEX IF NOT EXISTS writer_ai_usage_article_step_idx ON writer_ai_usage(article_id, step);









-- Three-stage article workflow, durable stage revisions, and queryable batches.
-- Legacy AI step numbers 2/3/4 remain in storage for backward compatibility.
ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS series_id UUID;
UPDATE content_plans SET series_id = id WHERE series_id IS NULL;
CREATE INDEX IF NOT EXISTS content_plans_series_version_idx ON content_plans(series_id, version DESC);

ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'not_started'
  CHECK (status IN ('not_started','queued','generating','in_progress','completed','failed','archived'));
ALTER TABLE content_plan_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS content_plan_items_status_idx ON content_plan_items(content_plan_id, status);

CREATE TABLE IF NOT EXISTS article_stage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), article_id TEXT NOT NULL REFERENCES writer_articles(id) ON DELETE CASCADE,
  content_plan_id UUID REFERENCES content_plans(id), content_plan_item_id UUID REFERENCES content_plan_items(id),
  stage TEXT NOT NULL CHECK (stage IN ('core_idea','outline','draft')), revision_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('running','completed','failed')),
  input_fingerprint TEXT NOT NULL, input_snapshot JSONB NOT NULL DEFAULT '{}', output_snapshot JSONB NOT NULL DEFAULT '{}',
  model TEXT, prompt_version TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(article_id, stage, revision_number), UNIQUE(article_id, stage, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS article_stage_runs_latest_idx ON article_stage_runs(article_id, stage, revision_number DESC);

CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY, content_plan_id UUID REFERENCES content_plans(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','completed','failed')),
  total_items INTEGER NOT NULL DEFAULT 0, completed_items INTEGER NOT NULL DEFAULT 0, failed_items INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0, total_cost_usd NUMERIC(12,6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS batch_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), batch_job_id TEXT NOT NULL REFERENCES batch_jobs(id) ON DELETE CASCADE,
  content_plan_item_id UUID REFERENCES content_plan_items(id), article_id TEXT NOT NULL REFERENCES writer_articles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','completed','failed')),
  error_message TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(batch_job_id, article_id)
);
CREATE INDEX IF NOT EXISTS batch_job_items_job_status_idx ON batch_job_items(batch_job_id, status);


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







-- Crawl metadata used by the automated Website Inventory pipeline.
ALTER TABLE website_content_inventory
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS http_status INTEGER,
  ADD COLUMN IF NOT EXISTS crawl_status TEXT NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS website_content_inventory_status_idx
  ON website_content_inventory(status, eligible_for_internal_link, last_checked DESC);

-- Cached semantic summaries for reliable internal-link selection.
ALTER TABLE website_content_inventory
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS primary_topic TEXT,
  ADD COLUMN IF NOT EXISTS search_intent TEXT,
  ADD COLUMN IF NOT EXISTS internal_link_anchors TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS key_claims TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary_version TEXT,
  ADD COLUMN IF NOT EXISTS summarized_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS website_content_inventory_summary_idx
  ON website_content_inventory(status, summarized_at DESC)
  WHERE summary IS NOT NULL;

-- Agent Hub MD Library index. Git remains the canonical source; these tables
-- cache immutable, commit-pinned chunks for low-token retrieval by the Hub.

CREATE TABLE IF NOT EXISTS agent_library_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  source_root TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}',
  document_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, source_commit, content_hash)
);

CREATE TABLE IF NOT EXISTS agent_library_documents (
  library_version_id TEXT NOT NULL REFERENCES agent_library_versions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('project', 'design', 'backend', 'database', 'policy')),
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (library_version_id, path)
);

CREATE TABLE IF NOT EXISTS agent_library_chunks (
  library_version_id TEXT NOT NULL REFERENCES agent_library_versions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('project', 'design', 'backend', 'database', 'policy')),
  chunk_index INTEGER NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (library_version_id, path, chunk_index)
);

CREATE INDEX IF NOT EXISTS agent_library_chunks_lookup_idx
  ON agent_library_chunks(project_id, library_version_id, layer, path, chunk_index);







