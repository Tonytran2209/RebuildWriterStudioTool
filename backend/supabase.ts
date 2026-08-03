import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * New Supabase key naming (supabase-js v2.x + @supabase/server):
 *   SUPABASE_URL            — project URL
 *   SUPABASE_SECRET_KEY     — replaces SERVICE_ROLE_KEY (full DB access, server-only)
 *   SUPABASE_PUBLISHABLE_KEY — replaces ANON_KEY (safe to expose to clients)
 *   SUPABASE_JWKS_URL       — for JWT verification via @supabase/server
 */

const TABLE = 'kv_store';

// Singleton — created once when Railway boots, reused for all requests
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;       // formerly SERVICE_ROLE_KEY

  if (!url) throw new Error('Missing SUPABASE_URL in Railway environment variables.');
  if (!key) throw new Error('Missing SUPABASE_SECRET_KEY in Railway environment variables.');

  _client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}

// ── KV operations ────────────────────────────────────────────────────────────

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw new Error(`kvGet(${key}): ${error.message}`);
  return (data?.value as T) ?? null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const { error } = await getClient()
    .from(TABLE)
    .upsert({ key, value }, { onConflict: 'key' });

  if (error) throw new Error(`kvSet(${key}): ${error.message}`);
}

export async function kvDelete(key: string): Promise<void> {
  const { error } = await getClient().from(TABLE).delete().eq('key', key);
  if (error) throw new Error(`kvDelete(${key}): ${error.message}`);
}

export async function kvGetByPrefix(prefix: string): Promise<{ key: string; value: any }[]> {
  const { data, error } = await getClient()
    .from(TABLE)
    .select('key, value')
    .like('key', `${prefix}%`);

  if (error) throw new Error(`kvGetByPrefix(${prefix}): ${error.message}`);
  return data ?? [];
}

export async function checkConnection(): Promise<boolean> {
  try {
    const { error } = await getClient().from(TABLE).select('key').limit(1);
    return !error;
  } catch {
    return false;
  }
}
