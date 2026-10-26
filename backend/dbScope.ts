import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { createPool, ident } from './postgres.ts';
import { OWNERSHIP_COLUMNS } from './importScope.ts';

async function main() {
  const output = process.argv.slice(2).find(a => a.startsWith('--output='))?.slice(9);
  if (!output || !process.env.SOURCE_DATABASE_URL || !process.env.DATABASE_URL) throw new Error('Usage: npm run db:scope -- --output=/private/path/scope-candidates.json (both database URLs required)');
  const identity = (value: string) => { const url = new URL(value); return url.hostname + ':' + (url.port || '5432') + url.pathname; };
  const pool = createPool(process.env.SOURCE_DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const entries = [];
    const inspection = [];
    for (const [table, columns] of Object.entries(OWNERSHIP_COLUMNS)) {
      const exists = await client.query('SELECT to_regclass($1) AS relation', ['public.' + table]);
      if (!exists.rows[0].relation) { inspection.push({ table, missing: true }); continue; }
      const column = columns[0];
      const filter = table === 'kv_store' ? "WHERE key LIKE 'writer:%'" : table.startsWith('agent_library_') ? "WHERE project_id='writer-studio'" : '';
      const candidates = await client.query(`SELECT DISTINCT ${ident(column)}::text AS id FROM public.${ident(table)} ${filter} ORDER BY 1`);
      const schema = await client.query('SELECT column_name,data_type,udt_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', ['public', table]);
      const triggers = await client.query('SELECT trigger_name,action_statement FROM information_schema.triggers WHERE event_object_schema=$1 AND event_object_table=$2', ['public', table]);
      inspection.push({ table, columns: schema.rows, triggers: triggers.rows });
      if (candidates.rows.length) entries.push({ table, column, values: candidates.rows.map(r => r.id), ownershipEvidence: '' });
      console.log(`${table}: ${candidates.rows.length} candidate identifiers (NOT ownership verified)`);
    }
    await client.query('ROLLBACK');
    await writeFile(output, JSON.stringify({ project: 'writer-studio', sourceIdentity: identity(process.env.SOURCE_DATABASE_URL), targetIdentity: identity(process.env.DATABASE_URL), entries, inspection, instructions: 'Remove all other-app identifiers, review every shared key payload and document ownershipEvidence. Candidate names/prefixes do not establish ownership. Do not use this file unreviewed.' }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log('Candidate manifest saved privately; deliberately invalid until ownershipEvidence is filled after review.');
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error('Scope inspection failed', error.code ?? 'VALIDATION', error.code ? 'Check source connection and local output path.' : error.message); process.exitCode = 1; });
