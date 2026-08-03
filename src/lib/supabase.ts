import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../utils/supabase/info';

const SUPABASE_URL = `https://${projectId}.supabase.co`;
const TABLE = 'kv_store_48d8062f';

// Singleton client — created once, reused across the app
export const supabase = createClient(SUPABASE_URL, publicAnonKey);

// ── KV helpers (mirrors the edge-function kv_store API) ──────────────────────

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(`supabase kvGet(${key}): ${error.message}`);
  return (data?.value as T) ?? null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, value }, { onConflict: 'key' });

  if (error) throw new Error(`supabase kvSet(${key}): ${error.message}`);
}

export async function kvDelete(key: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('key', key);
  if (error) throw new Error(`supabase kvDelete(${key}): ${error.message}`);
}

export async function kvGetByPrefix<T = any>(prefix: string): Promise<{ key: string; value: T }[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('key, value')
    .like('key', `${prefix}%`);

  if (error) throw new Error(`supabase kvGetByPrefix(${prefix}): ${error.message}`);
  return (data ?? []) as { key: string; value: T }[];
}
