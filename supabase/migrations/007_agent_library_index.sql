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

ALTER TABLE agent_library_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_library_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_library_chunks ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['agent_library_versions', 'agent_library_documents', 'agent_library_chunks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', table_name);
    EXECUTE format('CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;
