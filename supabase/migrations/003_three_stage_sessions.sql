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

-- Normalize legacy sessions and preserve their latest completed outputs as revision 1.
UPDATE writer_articles
SET current_step = 2,
    payload = jsonb_set(payload, '{currentStep}', '2'::jsonb, true)
WHERE current_step < 2;

INSERT INTO article_stage_runs (
  article_id, content_plan_id, content_plan_item_id, stage, revision_number,
  input_fingerprint, input_snapshot, output_snapshot, created_at
)
SELECT id, content_plan_id, content_plan_item_id, 'core_idea', 1,
  encode(digest((payload->'coreIdeaSuggestions')::text, 'sha256'), 'hex'),
  jsonb_build_object('topic', payload->'topic', 'keywords', payload->'keywords', 'contentType', payload->'contentType'),
  jsonb_build_object('suggestions', payload->'coreIdeaSuggestions', 'selectedId', payload->'selectedCoreIdeaId'), updated_at
FROM writer_articles WHERE jsonb_array_length(COALESCE(payload->'coreIdeaSuggestions', '[]'::jsonb)) > 0
ON CONFLICT DO NOTHING;

INSERT INTO article_stage_runs (
  article_id, content_plan_id, content_plan_item_id, stage, revision_number,
  input_fingerprint, input_snapshot, output_snapshot, created_at
)
SELECT id, content_plan_id, content_plan_item_id, 'outline', 1,
  encode(digest((payload->'outline')::text, 'sha256'), 'hex'),
  jsonb_build_object('selectedCoreIdeaId', payload->'selectedCoreIdeaId'),
  jsonb_build_object('sections', payload->'outline'), updated_at
FROM writer_articles WHERE jsonb_array_length(COALESCE(payload->'outline', '[]'::jsonb)) > 0
ON CONFLICT DO NOTHING;

INSERT INTO article_stage_runs (
  article_id, content_plan_id, content_plan_item_id, stage, revision_number,
  input_fingerprint, input_snapshot, output_snapshot, created_at
)
SELECT id, content_plan_id, content_plan_item_id, 'draft', 1,
  encode(digest(COALESCE(payload->>'draft', draft, ''), 'sha256'), 'hex'),
  jsonb_build_object('outline', payload->'outline'),
  jsonb_build_object('markdown', COALESCE(payload->>'draft', draft)), updated_at
FROM writer_articles WHERE COALESCE(payload->>'draft', draft, '') <> ''
ON CONFLICT DO NOTHING;

UPDATE content_plan_items item
SET status = CASE
  WHEN article.batch_status = 'failed' THEN 'failed'
  WHEN article.status = 'done' OR article.batch_status = 'completed' THEN 'completed'
  WHEN article.batch_status = 'queued' THEN 'queued'
  ELSE 'in_progress'
END,
updated_at = article.updated_at
FROM writer_articles article
WHERE article.content_plan_item_id = item.id;

INSERT INTO batch_jobs (id, content_plan_id, status, total_items, completed_items, failed_items, created_at, updated_at)
SELECT activity_id, (array_agg(content_plan_id) FILTER (WHERE content_plan_id IS NOT NULL))[1],
  CASE
    WHEN bool_or(batch_status = 'running') THEN 'running'
    WHEN bool_or(batch_status = 'paused') THEN 'paused'
    WHEN bool_and(batch_status = 'completed') THEN 'completed'
    WHEN bool_or(batch_status = 'failed') THEN 'failed'
    ELSE 'queued'
  END,
  count(*), count(*) FILTER (WHERE batch_status = 'completed'), count(*) FILTER (WHERE batch_status = 'failed'),
  min(created_at), max(updated_at)
FROM writer_articles
WHERE activity_id IS NOT NULL AND payload->>'activityKind' = 'batch'
GROUP BY activity_id
ON CONFLICT (id) DO NOTHING;

INSERT INTO batch_job_items (batch_job_id, content_plan_item_id, article_id, status, error_message, updated_at)
SELECT activity_id, content_plan_item_id, id,
  CASE WHEN batch_status IN ('queued','running','paused','completed','failed') THEN batch_status ELSE 'queued' END,
  error_message, updated_at
FROM writer_articles
WHERE activity_id IS NOT NULL AND payload->>'activityKind' = 'batch'
ON CONFLICT (batch_job_id, article_id) DO NOTHING;

ALTER TABLE article_stage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_job_items ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['article_stage_runs','batch_jobs','batch_job_items'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', table_name);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;
