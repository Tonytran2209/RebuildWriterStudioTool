BEGIN;
CREATE TABLE IF NOT EXISTS writer_studio.image_workers (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  name text NOT NULL,
  agent text NOT NULL CHECK (agent IN ('claude', 'codex')),
  secret_hash text NOT NULL,
  last_seen timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  preferred boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS writer_studio.image_worker_jobs (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  worker_id uuid NOT NULL REFERENCES writer_studio.image_workers(id),
  article_id text NOT NULL,
  suggestion_id text NOT NULL,
  anchor text NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ready','failed','inserted')),
  lease uuid,
  lease_until timestamptz,
  processing_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  asset_path text,
  mime text,
  error_code text
);
CREATE UNIQUE INDEX IF NOT EXISTS image_worker_active_suggestion ON writer_studio.image_worker_jobs(article_id, suggestion_id)
  WHERE status IN ('queued','running','ready','inserted');
CREATE INDEX IF NOT EXISTS image_worker_queue ON writer_studio.image_worker_jobs(worker_id, status, created_at);
CREATE INDEX IF NOT EXISTS image_worker_article ON writer_studio.image_worker_jobs(article_id, created_at DESC);
CREATE TABLE IF NOT EXISTS writer_studio.image_worker_runs (
  id uuid PRIMARY KEY,
  parent_run_id text NOT NULL,
  job text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','success','failed')),
  started_at timestamptz,
  ended_at timestamptz,
  error_code text
);
CREATE INDEX IF NOT EXISTS image_worker_runs_history ON writer_studio.image_worker_runs(started_at DESC);
COMMIT;
