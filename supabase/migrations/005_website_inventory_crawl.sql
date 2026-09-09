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
