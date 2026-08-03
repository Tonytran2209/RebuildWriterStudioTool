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
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER kv_store_updated_at
  BEFORE INSERT OR UPDATE ON kv_store
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: cho phép service_role (backend Railway) đọc/ghi tất cả
-- cho phép anon/publishable key đọc/ghi (frontend trực tiếp)
ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_service_role"
  ON kv_store FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "allow_all_anon"
  ON kv_store FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);
