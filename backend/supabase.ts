import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'kv_store_48d8062f';

// Singleton — Railway giữ process sống, tạo 1 lần dùng mãi
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong Railway environment variables.'
    );
  }

  _client = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _client;
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const sb = getClient();
  const { data, error } = await sb
    .from(TABLE)
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(`kvGet(${key}): ${error.message}`);
  return (data?.value as T) ?? null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const sb = getClient();
  const { error } = await sb
    .from(TABLE)
    .upsert({ key, value }, { onConflict: 'key' });

  if (error) throw new Error(`kvSet(${key}): ${error.message}`);
}

export async function kvDelete(key: string): Promise<void> {
  const sb = getClient();
  const { error } = await sb.from(TABLE).delete().eq('key', key);
  if (error) throw new Error(`kvDelete(${key}): ${error.message}`);
}

export async function kvGetByPrefix(prefix: string): Promise<{ key: string; value: any }[]> {
  const sb = getClient();
  const { data, error } = await sb
    .from(TABLE)
    .select('key, value')
    .like('key', `${prefix}%`);

  if (error) throw new Error(`kvGetByPrefix(${prefix}): ${error.message}`);
  return data ?? [];
}

// Kiểm tra kết nối — dùng ở /health endpoint
export async function checkConnection(): Promise<boolean> {
  try {
    const sb = getClient();
    const { error } = await sb.from(TABLE).select('key').limit(1);
    return !error;
  } catch {
    return false;
  }
}
