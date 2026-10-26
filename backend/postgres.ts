import pg from 'pg';
// Do not round source microseconds through JavaScript Date during migration.
pg.types.setTypeParser(1184, value => value);
pg.types.setTypeParser(1114, value => value);
pg.types.setTypeParser(1700, value => Number(value));

export const TABLES = ['kv_store', 'content_plans', 'content_plan_sources', 'content_plan_items', 'writer_articles', 'writer_ai_usage', 'article_stage_runs', 'batch_jobs', 'batch_job_items', 'article_specs', 'knowledge_items', 'website_content_inventory', 'quality_gate_runs', 'editorial_approvals', 'agent_library_versions', 'agent_library_documents', 'agent_library_chunks'] as const;
export function provider(): 'supabase' | 'postgres' {
  const value = process.env.DATABASE_PROVIDER ?? 'supabase';
  if (value !== 'supabase' && value !== 'postgres') throw new Error('Invalid DATABASE_PROVIDER');
  return value;
}
export function ident(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid database identifier');
  return `"${value}"`;
}
export function tableName(table: string): string {
  if (!(TABLES as readonly string[]).includes(table)) throw new Error('Table outside Writer Studio allow-list');
  return `writer_studio.${ident(table)}`;
}
export function createPool(connectionString: string | undefined) {
  if (!connectionString) throw new Error('Missing database connection configuration');
  const instance = new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, statement_timeout: 30000, query_timeout: 35000, application_name: 'writer-studio' });
  instance.on('error', error => console.error('Database idle connection error', (error as any).code ?? 'UNKNOWN'));
  return instance;
}
let pool: pg.Pool | undefined;
export function database() {
  if (!pool) pool = createPool(process.env.DATABASE_URL);
  return pool;
}
export async function closeDatabase() { await pool?.end(); pool = undefined; }

// Preserve PostgREST JSON shape: timestamps and NUMERIC are serialized values.
export function normalizeRow(row: Record<string, any>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}
export class SelectQuery {
  private columns = '*';
  private filters: string[] = [];
  private values: unknown[] = [];
  private ordering: string[] = [];
  private count?: number;
  private offset = 0;
  select(columns: string) { this.columns = columns === '*' ? '*' : columns.split(',').map(c => ident(c.trim())).join(','); return this; }
  private filter(column: string, operator: string, value: unknown) {
    this.values.push(value); this.filters.push(`${ident(column)} ${operator} $${this.values.length}`); return this;
  }
  eq(column: string, value: unknown) { return this.filter(column, '=', value); }
  neq(column: string, value: unknown) { return this.filter(column, '<>', value); }
  like(column: string, value: string) { return this.filter(column, 'LIKE', value); }
  order(column: string, options: { ascending?: boolean } = {}) { this.ordering.push(`${ident(column)} ${options.ascending === false ? 'DESC NULLS FIRST' : 'ASC NULLS LAST'}`); return this; }
  limit(count: number) { if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid limit'); this.count = count; return this; }
  range(from: number, to: number) { if (!Number.isSafeInteger(from) || from < 0) throw new Error('Invalid offset'); this.offset = from; return this.limit(to - from + 1); }
  compile(table: string) {
    return { text: `SELECT ${this.columns} FROM ${tableName(table)}${this.filters.length ? ' WHERE ' + this.filters.join(' AND ') : ''}${this.ordering.length ? ' ORDER BY ' + this.ordering.join(',') : ''}${this.count !== undefined ? ' LIMIT ' + this.count : ''} OFFSET ${this.offset}`, values: this.values };
  }
}
export async function selectRows<T = any>(table: string, configure?: (query: SelectQuery) => SelectQuery, pool = database()): Promise<T[]> {
  const q = new SelectQuery(); const configured = configure ? configure(q) : q;
  const compiled = configured.compile(table);
  const result = await pool.query(compiled.text, compiled.values);
  return result.rows.map(normalizeRow) as T[];
}
// pg encodes JS arrays as SQL arrays, so JSONB must be explicitly serialized.
export async function rowValues(client: pg.Pool | pg.PoolClient, table: string, row: Record<string, unknown>, rawJson = false) {
  tableName(table);
  const { rows } = await client.query('SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', ['writer_studio', table]);
  const columns = new Map(rows.map(c => [c.column_name, c.data_type]));
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  for (const [key] of entries) if (!columns.has(key)) throw new Error(`Unknown column ${table}.${ident(key)}`);
  return { keys: entries.map(([key]) => key), values: entries.map(([key, value]) => value !== null && !rawJson && ['json', 'jsonb'].includes(columns.get(key)) ? JSON.stringify(value) : value) };
}
export async function insertRow(table: string, row: Record<string, unknown>, conflict?: string, client: pg.Pool | pg.PoolClient = database(), rawJson = false) {
  const { keys, values } = await rowValues(client, table, row, rawJson);
  if (!keys.length) throw new Error('Empty database row');
  let suffix = '';
  if (conflict) {
    const targets = conflict.split(',').map(s => s.trim());
    const updates = keys.filter(k => !targets.includes(k));
    suffix = ` ON CONFLICT (${targets.map(ident).join(',')}) DO ${updates.length ? 'UPDATE SET ' + updates.map(k => `${ident(k)}=EXCLUDED.${ident(k)}`).join(',') : 'NOTHING'}`;
  }
  const result = await client.query(`INSERT INTO ${tableName(table)} (${keys.map(ident).join(',')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(',')})${suffix} RETURNING *`, values);
  return result.rows[0] ? normalizeRow(result.rows[0]) : undefined;
}
export async function updateRow(table: string, id: string, row: Record<string, unknown>, pool = database()) {
  const { keys, values } = await rowValues(pool, table, row);
  if (!keys.length) throw new Error('Empty database update');
  const result = await pool.query(`UPDATE ${tableName(table)} SET ${keys.map((k, i) => `${ident(k)}=$${i + 1}`).join(',')} WHERE id=$${values.length + 1} RETURNING *`, [...values, id]);
  if (result.rowCount !== 1) throw new Error(`${table}: expected exactly one row to update`);
  return normalizeRow(result.rows[0]);
}
export async function deleteRows(table: string, column: string, value: string, pool = database()) { await pool.query(`DELETE FROM ${tableName(table)} WHERE ${ident(column)}=$1`, [value]); }
export async function available(table: string, pool = database()) {
  tableName(table);
  const result = await pool.query('SELECT to_regclass($1) IS NOT NULL AS available', [`writer_studio.${table}`]);
  return result.rows[0].available as boolean;
}
export async function insertStageRevision(row: Record<string, unknown>, pool = database()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-stage:${row.article_id}:${row.stage}`]);
    const existing = await client.query('SELECT * FROM writer_studio.article_stage_runs WHERE article_id=$1 AND stage=$2 AND input_fingerprint=$3', [row.article_id, row.stage, row.input_fingerprint]);
    if (existing.rows.length) { await client.query('COMMIT'); return normalizeRow(existing.rows[0]); }
    const revision = await client.query('SELECT COALESCE(MAX(revision_number),0)+1 AS next FROM writer_studio.article_stage_runs WHERE article_id=$1 AND stage=$2', [row.article_id, row.stage]);
    const result = await insertRow('article_stage_runs', { ...row, revision_number: revision.rows[0].next }, undefined, client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
