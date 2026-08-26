-- Versioned Content Plans and queryable article/usage projections.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

ALTER TABLE content_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_plan_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE writer_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE writer_ai_usage ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['content_plans','content_plan_sources','content_plan_items','writer_articles','writer_ai_usage'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', table_name);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;
