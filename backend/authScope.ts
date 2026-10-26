import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { createPool } from './postgres.ts';
async function main() {
  const file = process.argv.slice(2).find(a => a.startsWith('--output='))?.slice(9);
  if (!file || !process.env.SOURCE_DATABASE_URL || !process.env.DATABASE_URL) throw new Error('Usage: npm run auth:scope -- --output=/private/auth-scope.json');
  const pool = createPool(process.env.SOURCE_DATABASE_URL);
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await client.query("SELECT id,email,raw_app_meta_data->>'role' AS role,email_confirmed_at IS NOT NULL AS verified FROM auth.users u WHERE email IS NOT NULL AND to_jsonb(u)->>'deleted_at' IS NULL ORDER BY id");
    const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase());
    const identity = (value: string) => { const u = new URL(value); return u.hostname + ':' + (u.port || '5432') + u.pathname; };
    const scope = { project: 'writer-studio', sourceIdentity: identity(process.env.SOURCE_DATABASE_URL),
      targetIdentity: identity(process.env.DATABASE_URL), users: result.rows.map(row => ({
        id: row.id, email: row.email, role: row.role === 'admin' || admins.includes(row.email.toLowerCase()) ? 'admin' : 'user',
        emailVerified: row.verified, ownershipEvidence: '',
      })) };
    await client.query('ROLLBACK');
    await writeFile(file, JSON.stringify(scope, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`${scope.users.length} candidates saved privately. Auth is shared across apps even when data schemas differ. Keep only Writer Studio accounts; verify role and ownershipEvidence. No hashes exported.`);
  } finally { client?.release(); await pool.end(); }
}
main().catch(e => { console.error('Auth scope failed:', e.code ?? e.message); process.exitCode = 1; });
