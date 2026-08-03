import { createClient } from '@supabase/supabase-js';

/**
 * Frontend Supabase client — uses PUBLISHABLE_KEY (safe for browser).
 *
 * For local dev: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env
 * For Railway/Vercel: set the same vars in the service environment.
 */

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL as string | undefined ??
  'https://zjyxhqgjnyfexmdvfnjr.supabase.co';

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined ??
  'sb_publishable_y_fdriMaj_0HuSUBLehuTA_r-VJkQaU';

const TABLE = 'kv_store';

// Singleton client
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

// ── KV helpers ────────────────────────────────────────────────────────────────

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
