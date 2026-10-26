import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPool } from './postgres.ts';
export async function migrateAuth(pool = createPool(process.env.DATABASE_URL)) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('writer-studio-schema'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS writer_studio');
    await client.query('CREATE TABLE IF NOT EXISTS writer_studio.auth_schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const sql = await readFile(new URL('./migrations/002_auth.sql', import.meta.url), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const result = await client.query('SELECT version,checksum FROM writer_studio.auth_schema_migrations');
    if (result.rows.some(r => r.version !== 1 || r.checksum !== checksum)) throw new Error('Auth migration checksum/version mismatch');
    if (!result.rows.length) {
      await client.query(sql);
      await client.query('INSERT INTO writer_studio.auth_schema_migrations(version,checksum) VALUES (1,$1)', [checksum]);
    }
    await client.query('COMMIT');
    console.log('Auth schema verified. Provider unchanged.');
  } catch (error) { await client?.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client?.release(); await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  migrateAuth().catch(e => { console.error('Auth migration failed:', e.code ?? e.message); process.exitCode = 1; });
