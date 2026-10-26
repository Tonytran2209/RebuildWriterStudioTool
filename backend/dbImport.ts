import 'dotenv/config';
import type { PoolClient } from 'pg';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool, ident, tableName, insertRow } from './postgres.ts';
import { validateScope } from './importScope.ts';

function identity(url: string) { const parsed = new URL(url); return parsed.hostname + ':' + (parsed.port || '5432') + parsed.pathname; }
export async function importData(args = process.argv.slice(2), poolFactory = createPool) {
  const scopeFile = args.find(arg => arg.startsWith('--scope='))?.slice(8);
  if (!scopeFile) throw new Error('Usage: npm run db:import -- --scope=/private/path/scope.json [--apply] [--legacy]');
  if (args.some(a => !a.startsWith('--scope=') && !['--apply', '--legacy'].includes(a))) throw new Error('Unknown import argument');
  const scope = validateScope(JSON.parse(await readFile(scopeFile, 'utf8')));
  const legacy = args.includes('--legacy');
  const apply = args.includes('--apply');
  if (legacy && scope.entries.some(e => e.table !== 'kv_store')) throw new Error('Legacy mode accepts only explicitly reviewed legacy KV keys; relational imports are independent');
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl || identity(sourceUrl) === identity(targetUrl)) throw new Error('Distinct SOURCE_DATABASE_URL and DATABASE_URL required');
  if (identity(sourceUrl) !== scope.sourceIdentity || identity(targetUrl) !== scope.targetIdentity) throw new Error('Connection identity does not match reviewed ownership manifest');
  const sourcePool = poolFactory(sourceUrl), targetPool = poolFactory(targetUrl);
  let source: PoolClient | undefined;
  let target: PoolClient | undefined;
  const heartbeat = setInterval(() => console.log('Import heartbeat: transaction active'), 15000);
  try {
    source = await sourcePool.connect();
    target = await targetPool.connect();
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await source.query("SET LOCAL TIME ZONE 'UTC'");
    await source.query("SET LOCAL idle_in_transaction_session_timeout='120s'");
    await target.query('BEGIN');
    await target.query("SET LOCAL TIME ZONE 'UTC'");
    await target.query("SET LOCAL writer_studio.importing='on'");
    await target.query("SET LOCAL lock_timeout='10s'");
    await target.query("SELECT pg_advisory_xact_lock(hashtext('writer-studio-schema'))");
    const version = await target.query('SELECT version, checksum FROM writer_studio.schema_migrations');
    const schemaHash = createHash('sha256').update(await readFile(new URL('./migrations/001_writer_studio.sql', import.meta.url), 'utf8')).digest('hex');
    if (version.rows.length !== 1 || version.rows[0].version !== 1 || version.rows[0].checksum !== schemaHash) throw new Error('Run matching db:migrate first; schema version/checksum mismatch');
    await target.query('SET CONSTRAINTS ALL DEFERRED');
    // Prevent simultaneous app writes during preflight, import and verification.
    for (const entry of scope.entries) await target.query(`LOCK TABLE ${tableName(entry.table)} IN SHARE ROW EXCLUSIVE MODE`);
    for (const entry of scope.entries) {
      const sourceTable = legacy ? 'kv_store_48d8062f' : entry.table;
      const relation = `public.${ident(sourceTable)}`;
      const filter = `${ident(entry.column)}::text = ANY($1::text[])`;
      const sourceCols = await source.query('SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', ['public', sourceTable]);
      const targetCols = await target.query('SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', ['writer_studio', entry.table]);
      if (!sourceCols.rows.length || sourceCols.rows.some(s => !targetCols.rows.some(t => t.column_name === s.column_name && t.data_type === s.data_type && t.udt_name === s.udt_name))) throw new Error(`Source/target column mismatch: ${entry.table}`);
      // Keep JSON as PostgreSQL text: JSON null differs from SQL NULL, and
      // numbers inside JSON can exceed JavaScript's safe integer precision.
      const importColumns = sourceCols.rows.map(c => ['json', 'jsonb'].includes(c.data_type) ? `${ident(c.column_name)}::text AS ${ident(c.column_name)}` : ident(c.column_name)).join(',');
      const before = await target.query(`SELECT count(*)::int AS n FROM ${tableName(entry.table)}`);
      const existing = await target.query(`SELECT 1 FROM ${tableName(entry.table)} WHERE ${filter} LIMIT 1`, [entry.values]);
      if (existing.rowCount) throw new Error(`Target already contains selected ${entry.table} records; refusing overwrite`);
      const expected = await source.query(`SELECT count(*)::int AS n FROM ${relation} WHERE ${filter}`, [entry.values]);
      const count = expected.rows[0].n;
      if (!count) throw new Error(`No source rows match ${entry.table}; review scope instead of silently omitting data`);
      // Key/id scopes must resolve every supplied identifier.
      if (['key', 'id'].includes(entry.column) && count !== entry.values.length) throw new Error(`Missing source IDs in ${entry.table}`);
      console.log(`${entry.table}: ${count} source rows; reading snapshot in batches of 100`);
      await source.query(`DECLARE writer_import_cursor NO SCROLL CURSOR FOR SELECT ${importColumns} FROM ${relation} WHERE ${filter}`, [entry.values]);
      let done = 0;
      while (true) {
        const batch = await source.query('FETCH FORWARD 100 FROM writer_import_cursor');
        if (!batch.rowCount) break;
        for (const row of batch.rows) {
          // Legacy KV has no updated_at; preserve all available fields, use target default only when absent.
          if (apply) await insertRow(entry.table, row, undefined, target, true);
          done++;
        }
        console.log(`${entry.table}: ${done}/${count} ${apply ? 'staged (not committed)' : 'read (dry-run)'}`);
      }
      await source.query('CLOSE writer_import_cursor');
      if (!apply) continue;
      const after = await target.query(`SELECT count(*)::int AS n FROM ${tableName(entry.table)}`);
      if (after.rows[0].n !== before.rows[0].n + count) throw new Error(`Count verification failed: ${entry.table}`);
      // PostgreSQL renders canonical jsonb identically; verify all imported fields including payloads, IDs and timestamps.
      const sourceColumns = await source.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', ['public', sourceTable]);
      const columns = sourceColumns.rows.map(r => ident(r.column_name)).join(',');
      const hashes: string[] = [];
      for (const [client, table] of [[source, relation], [target, tableName(entry.table)]] as const) {
        await client.query(`DECLARE writer_verify_cursor NO SCROLL CURSOR FOR SELECT to_jsonb(r)::text AS row FROM (SELECT ${columns} FROM ${table} WHERE ${filter}) r ORDER BY to_jsonb(r)::text COLLATE "C"`, [entry.values]);
        const hash = createHash('sha256');
        while (true) {
          const batch = await client.query('FETCH FORWARD 100 FROM writer_verify_cursor');
          if (!batch.rowCount) break;
          for (const row of batch.rows) hash.update(row.row + '\n');
        }
        await client.query('CLOSE writer_verify_cursor');
        hashes.push(hash.digest('hex'));
      }
      if (hashes[0] !== hashes[1]) throw new Error(`Full-row checksum mismatch: ${entry.table}; transaction rolled back`);
      console.log(`${entry.table}: counts and full-row checksum verified`);
    }
    await target.query('SET CONSTRAINTS ALL IMMEDIATE');
    await target.query(args.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
    await source.query('ROLLBACK');
    console.log(apply ? 'Import committed. Keep writes paused until files and smoke tests pass.' : 'Dry-run passed: snapshot, selected IDs, empty destination scope and column types verified. No rows written. Constraints and full-row checksums are checked by --apply before commit.');
  } catch (error) { await target?.query('ROLLBACK').catch(() => {}); await source?.query('ROLLBACK').catch(() => {}); throw error; }
  finally { clearInterval(heartbeat); source?.release(); target?.release(); await Promise.all([sourcePool.end(), targetPool.end()]); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) importData().catch(error => { console.error('Import stopped', error.code ?? 'VALIDATION', error.code ? 'Database rejected operation. SQLSTATE shown; inspect source/target constraints locally. No row values logged.' : error.message); process.exitCode = 1; });
