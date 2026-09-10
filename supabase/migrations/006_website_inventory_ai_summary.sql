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
