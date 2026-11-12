BEGIN;
CREATE TABLE IF NOT EXISTS writer_studio.image_style_versions (
  owner_id text NOT NULL,
  style_id text NOT NULL CHECK (style_id ~ '^[a-z][a-z0-9-]{2,49}$'),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  description text NOT NULL,
  visual_rules text NOT NULL,
  guide_path text,
  guide_sha256 text,
  reference_path text,
  reference_sha256 text,
  reference_name text,
  model_family text NOT NULL CHECK (model_family IN ('sdxl','text-only')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  PRIMARY KEY (owner_id,style_id,version)
);
CREATE INDEX IF NOT EXISTS image_style_approved ON writer_studio.image_style_versions(owner_id,style_id,version DESC) WHERE status='approved';
COMMIT;
