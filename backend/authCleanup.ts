import 'dotenv/config';
import { createPool } from './postgres.ts';
async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--apply')) throw new Error('Usage: npm run auth:cleanup -- [--apply]');
  const pool = createPool(process.env.DATABASE_URL);
  let client;
  try {
    client = await pool.connect(); await client.query('BEGIN');
    const policies = [
      ['auth_sessions', "expires_at < now()-interval '7 days'"],
      ['auth_tokens', "expires_at < now()-interval '7 days'"],
      ['auth_rate_limits', "expires_at < now()-interval '1 day'"],
      ['auth_audit_events', "created_at < now()-interval '90 days'"],
    ];
    for (const [table, predicate] of policies) {
      const count = await client.query(`SELECT count(*) AS count FROM writer_studio.${table} WHERE ${predicate}`);
      console.log(table, count.rows[0].count, 'expired records');
      if (args.includes('--apply')) await client.query(`DELETE FROM writer_studio.${table} WHERE ${predicate}`);
    }
    await client.query(args.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  } catch (e) { await client?.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client?.release(); await pool.end(); }
}
main().catch(e => { console.error('Auth cleanup failed:', e.code ?? e.message); process.exitCode = 1; });
