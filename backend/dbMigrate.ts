import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool } from './postgres.ts';

export async function migrate(pool = createPool(process.env.DATABASE_URL)) {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('writer-studio-schema'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS writer_studio');
    await client.query('CREATE TABLE IF NOT EXISTS writer_studio.schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const sql = await readFile(new URL('./migrations/001_writer_studio.sql', import.meta.url), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const { rows } = await client.query('SELECT version, checksum FROM writer_studio.schema_migrations ORDER BY version');
    if (rows.some(row => row.version !== 1 || row.checksum !== checksum)) throw new Error('Migration version/checksum mismatch; stop and review deployed schema');
    if (!rows.length) {
      const existing = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='writer_studio' AND tablename <> 'schema_migrations'");
      if (existing.rowCount) throw new Error('Unversioned target schema is not empty');
      await client.query(sql);
      // Preserve immediate enforcement normally; imports defer cyclic/self references until verification.
      const foreignKeys = await client.query("SELECT conrelid::regclass::text AS relation, conname FROM pg_constraint WHERE contype='f' AND connamespace='writer_studio'::regnamespace");
      for (const fk of foreignKeys.rows) {
        const relation = fk.relation.split('.').pop().replaceAll('"', '');
        const { ident, tableName } = await import('./postgres.ts');
        await client.query(`ALTER TABLE ${tableName(relation)} ALTER CONSTRAINT ${ident(fk.conname)} DEFERRABLE INITIALLY IMMEDIATE`);
      }
      await client.query('INSERT INTO writer_studio.schema_migrations(version, checksum) VALUES (1,$1)', [checksum]);
    }
    await client.query('COMMIT');
    console.log('Writer Studio schema version 1 verified');
  } catch (error) { await client?.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client?.release(); await pool.end(); }
}
// Do not log driver error detail: it can contain row values or credentials.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) migrate().catch((error) => { console.error('Migration failed', error.code ?? 'VALIDATION', error.code ? 'Check schema, permissions and connection configuration locally.' : error.message); process.exitCode = 1; });
