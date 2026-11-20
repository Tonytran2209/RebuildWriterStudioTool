import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { createPool } from './postgres.ts';
import { AUTH_ROLES, AuthService, hashPassword, normalizeUsername, type AuthRole } from './authService.ts';

type AccountSpec = { username: string; role: AuthRole; from?: string };

export function parseAccounts(args: string[]): AccountSpec[] {
  const specs = args.filter(a => a.startsWith('--account=')).map(a => {
    const [username, role, from] = a.slice('--account='.length).split(':');
    if (!AUTH_ROLES.includes(role as AuthRole)) throw new Error(`Role must be one of ${AUTH_ROLES.join(', ')}`);
    return { username: normalizeUsername(username ?? ''), role: role as AuthRole, from: from?.trim().toLowerCase() || undefined };
  });
  if (!specs.length || args.some(a => !a.startsWith('--account=') && a !== '--apply'))
    throw new Error('Usage: ACCOUNT_PASSWORD=... npm run auth:accounts -- --account=<username>:<user|reviewer|admin>[:<existing username, email or email name>] [--apply]');
  return specs;
}

/**
 * Create or update username accounts with one shared password.
 * `from` renames an existing account (matched by username, email or the part before @) instead of creating one.
 * Dry-run unless --apply; any password change signs that account out everywhere.
 */
export async function provisionAccounts(args = process.argv.slice(2), password: string, pool: Pool) {
  const specs = parseAccounts(args);
  const apply = args.includes('--apply');
  const passwordHash = await hashPassword(password);
  const service = new AuthService(pool);
  const report: string[] = [];
  try {
    await service.transaction(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('writer-auth-admin'))");
      for (const spec of specs) {
        let target = (await c.query('SELECT id FROM writer_studio.auth_users WHERE username=$1 FOR UPDATE', [spec.username])).rows[0];
        if (!target && spec.from) {
          const found = await c.query("SELECT id FROM writer_studio.auth_users WHERE username=$1 OR email=$1 OR split_part(email,'@',1)=$1 FOR UPDATE", [spec.from]);
          if (found.rows.length !== 1) throw new Error(`"${spec.from}" must match exactly one account (found ${found.rows.length})`);
          target = found.rows[0];
        }
        if (target) {
          await c.query("UPDATE writer_studio.auth_users SET username=$2,role=$3,password_hash=$4,status='active',email_verified=true,updated_at=now() WHERE id=$1", [target.id, spec.username, spec.role, passwordHash]);
          await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [target.id]);
          await service.audit(c, 'account_provisioned:update', target.id);
          report.push(`${spec.username}: updated (${spec.role})`);
        } else {
          const created = await c.query("INSERT INTO writer_studio.auth_users(username,role,password_hash,status,email_verified) VALUES ($1,$2,$3,'active',true) RETURNING id", [spec.username, spec.role, passwordHash]);
          await service.audit(c, 'account_provisioned:create', created.rows[0].id);
          report.push(`${spec.username}: created (${spec.role})`);
        }
      }
      const admins = await c.query("SELECT 1 FROM writer_studio.auth_users WHERE role='admin' AND status='active' AND email_verified");
      if (!admins.rows.length) throw new Error('At least one active admin must remain');
      if (!apply) throw new DryRun();
    });
  } catch (error) { if (!(error instanceof DryRun)) throw error; }
  for (const line of report) console.log(line);
  console.log(apply ? 'Accounts saved.' : 'Dry run only: nothing saved. Add --apply to save.');
  return report;
}
class DryRun extends Error {}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
{
  const pool = createPool(process.env.DATABASE_URL);
  provisionAccounts(process.argv.slice(2), process.env.ACCOUNT_PASSWORD ?? '', pool)
    .catch(e => { console.error('Account provisioning stopped:', e.code ?? e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
