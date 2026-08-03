import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const TABLE = 'kv_store_48d8062f';

function client() {
  if (!supabaseUrl || !supabaseKey) return null;
  return createClient(supabaseUrl, supabaseKey);
}

export async function kvGet(key: string): Promise<any> {
  const sb = client();
  if (!sb) return null;
  const { data, error } = await sb.from(TABLE).select('value').eq('key', key).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? null;
}

export async function kvSet(key: string, value: any): Promise<void> {
  const sb = client();
  if (!sb) return;
  const { error } = await sb.from(TABLE).upsert({ key, value });
  if (error) throw new Error(error.message);
}

export async function kvGetByPrefix(prefix: string): Promise<{ key: string; value: any }[]> {
  const sb = client();
  if (!sb) return [];
  const { data, error } = await sb.from(TABLE).select('key, value').like('key', `${prefix}%`);
  if (error) throw new Error(error.message);
  return data ?? [];
}
