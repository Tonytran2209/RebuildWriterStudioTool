import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createPool } from './postgres.ts';
import { normalizeEmail, supportedLegacyHash, AuthService } from './authService.ts';
import type { PoolClient } from 'pg';
export function authScope(value: any) {
  if (value?.project !== 'writer-studio' || !value.sourceIdentity || !value.targetIdentity || !Array.isArray(value.users) || !value.users.length) throw new Error('Reviewed auth scope required');
  const ids = new Set(), emails = new Set();
  for (const user of value.users) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) || !['user','admin'].includes(user.role) || !user.ownershipEvidence?.trim()) throw new Error('Explicit user ID, role and ownership evidence required');
    user.email = normalizeEmail(user.email);
    if (ids.has(user.id.toLowerCase()) || emails.has(user.email)) throw new Error('Duplicate auth scope');
    ids.add(user.id.toLowerCase()); emails.add(user.email);
  }
  return value as { project: string; sourceIdentity: string; targetIdentity: string; users: { id: string; email: string; role: string; ownershipEvidence: string }[] };
}
export async function importAuth(args = process.argv.slice(2), poolFactory = createPool) {
  const file = args.find(a => a.startsWith('--scope='))?.slice(8);
  if (!file || args.some(a => !a.startsWith('--scope=') && !['--apply','--allow-password-reset'].includes(a))) throw new Error('Usage: npm run auth:import -- --scope=/private/users.json [--apply] [--allow-password-reset]');
  const scope = authScope(JSON.parse(await readFile(file, 'utf8')));
  const sourceUrl = process.env.SOURCE_DATABASE_URL, targetUrl = process.env.DATABASE_URL;
  const identity = (url: string) => { const u = new URL(url); return u.hostname + ':' + (u.port || '5432') + u.pathname; };
  if (!sourceUrl || !targetUrl || identity(sourceUrl) !== scope.sourceIdentity || identity(targetUrl) !== scope.targetIdentity || identity(sourceUrl) === identity(targetUrl)) throw new Error('Source/target identities must match reviewed manifest and be distinct');
  const sourcePool = poolFactory(sourceUrl), targetPool = poolFactory(targetUrl);
  let source: PoolClient | undefined, target: PoolClient | undefined;
  let copied = 0, resets = 0;
  try {
    source = await sourcePool.connect(); target = await targetPool.connect();
    await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await target.query('BEGIN');
    await target.query("SET LOCAL lock_timeout='10s'");
    await target.query("SELECT pg_advisory_xact_lock(hashtext('writer-auth-admin'))");
    await target.query('LOCK TABLE writer_studio.auth_users IN SHARE ROW EXCLUSIVE MODE');
    const hasMfa = (await source.query("SELECT to_regclass('auth.mfa_factors') IS NOT NULL AS present")).rows[0].present;
    for (const expected of scope.users) {
      const result = await source.query(`SELECT id,email,encrypted_password,email_confirmed_at,created_at,
        COALESCE((to_jsonb(u)->>'banned_until')::timestamptz>now(),false) AS banned,to_jsonb(u)->>'deleted_at' AS deleted_at,
        COALESCE((to_jsonb(u)->>'is_sso_user')::boolean,false) AS sso
        FROM auth.users u WHERE id=$1`, [expected.id]);
      const user = result.rows[0];
      if (!user || normalizeEmail(user.email) !== expected.email || user.deleted_at) throw new Error('Source identity mismatch, missing or deleted user; review manifest');
      if (user.sso) throw new Error('SSO account requires a separate identity-provider migration');
      if (hasMfa && (await source.query("SELECT 1 FROM auth.mfa_factors WHERE user_id=$1 AND status='verified' LIMIT 1", [user.id])).rowCount) throw new Error('MFA account requires a separate MFA migration; refusing to downgrade authentication');
      const existing = await target.query('SELECT id FROM writer_studio.auth_users WHERE id=$1 OR email=$2', [user.id, expected.email]);
      if (existing.rowCount) throw new Error('Target account exists; refusing overwrite');
      const supported = supportedLegacyHash(user.encrypted_password);
      if (!supported && !args.includes('--allow-password-reset')) throw new Error('Account requires password reset; configure email and explicitly pass --allow-password-reset');
      if (!supported) resets++;
      if (args.includes('--apply')) {
        const status = user.banned ? 'disabled' : 'active';
        await target.query(`INSERT INTO writer_studio.auth_users(id,email,password_hash,role,status,email_verified,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [user.id, expected.email, supported ? user.encrypted_password : null, expected.role, status, !!user.email_confirmed_at, user.created_at]);
        const saved = (await target.query('SELECT id,email,password_hash,role,status,email_verified FROM writer_studio.auth_users WHERE id=$1', [user.id])).rows[0];
        if (saved.email !== expected.email || saved.role !== expected.role || saved.status !== status || saved.email_verified !== !!user.email_confirmed_at || saved.password_hash !== (supported ? user.encrypted_password : null)) throw new Error('Auth import verification failed');
        await new AuthService(targetPool).audit(target, 'account_imported', user.id);
      }
      copied++;
      console.log(`Auth ${copied}/${scope.users.length}: ${supported ? 'compatible password hash' : 'password reset required'}; ${args.includes('--apply') ? 'staged' : 'dry-run'}`);
    }
    await target.query(args.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
    await source.query('ROLLBACK');
    console.log(`Auth ${args.includes('--apply') ? 'import committed' : 'dry-run passed'}: ${copied} accounts, ${resets} require password reset. Existing Supabase sessions are not imported.`);
  } catch (error) { await target?.query('ROLLBACK').catch(() => {}); await source?.query('ROLLBACK').catch(() => {}); throw error; }
  finally { source?.release(); target?.release(); await sourcePool.end(); await targetPool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  importAuth().catch(e => { console.error('Auth import stopped:', e.code ?? e.message); process.exitCode = 1; });
