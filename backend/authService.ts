import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Pool, PoolClient } from 'pg';
import { database } from './postgres.ts';

export class AuthError extends Error { constructor(message: string, public status = 401) { super(message); } }
export function authProvider() {
  const provider = process.env.AUTH_PROVIDER ?? 'supabase';
  if (!['supabase', 'postgres'].includes(provider)) throw new Error('Invalid AUTH_PROVIDER');
  return provider;
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const token = () => randomBytes(32).toString('base64url');
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('Email không hợp lệ.', 400);
  return email;
}
export function checkPassword(password: string) {
  if (password.length < 12 || Buffer.byteLength(password) > 1024) throw new AuthError('Mật khẩu cần ít nhất 12 ký tự, tối đa 1024 bytes.', 400);
}
let passwordWorkers = 0;
async function passwordWork<T>(fn: () => Promise<T>) {
  if (passwordWorkers >= 4) throw new AuthError('Đăng nhập đang bận. Vui lòng thử lại.', 429);
  passwordWorkers++;
  try { return await fn(); } finally { passwordWorkers--; }
}
const derive = (password: string, salt: string) => passwordWork(() => new Promise<Buffer>((resolve, reject) =>
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, key) => e ? reject(e) : resolve(key))));
export async function hashPassword(password: string) {
  checkPassword(password);
  return encodePassword(password);
}
async function encodePassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return 'scrypt-v1$' + salt + '$' + (await derive(password, salt)).toString('hex');
}
export function supportedLegacyHash(hash: unknown): hash is string {
  return typeof hash === 'string' && /^\$2[aby]\$(0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(hash);
}
export async function verifyPassword(password: string, hash: string | null) {
  if (Buffer.byteLength(password) > 1024) return false;
  if (hash?.startsWith('scrypt-v1$')) {
    const [, salt, expected] = hash.split('$');
    if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
    return timingSafeEqual(await derive(password, salt), Buffer.from(expected, 'hex'));
  }
  if (supportedLegacyHash(hash)) return passwordWork(() => bcrypt.compare(password, hash.replace(/^\$2y\$/, '$2b$')));
  // Make unknown/unimported accounts perform password work as well.
  await derive(password, '00000000000000000000000000000000');
  return false;
}
export type AuthUser = { id: string; email: string; role: 'user' | 'admin'; status: string; email_verified: boolean; password_hash?: string };
export class AuthService {
  constructor(public pool: Pool = database()) {}
  async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
    finally { c.release(); }
  }
  async audit(c: Pool | PoolClient, event: string, userId?: string) {
    await c.query('INSERT INTO writer_studio.auth_audit_events(user_id,event) VALUES ($1,$2)', [userId ?? null, event]);
  }
  async throttle(key: string, limit: number) {
    const result = await this.pool.query(`INSERT INTO writer_studio.auth_rate_limits(key,attempts,expires_at)
      VALUES ($1,1,now()+interval '15 minutes')
      ON CONFLICT(key) DO UPDATE SET
      attempts=CASE WHEN auth_rate_limits.expires_at < now() THEN 1 ELSE auth_rate_limits.attempts+1 END,
      expires_at=CASE WHEN auth_rate_limits.expires_at < now() THEN now()+interval '15 minutes' ELSE auth_rate_limits.expires_at END
      RETURNING attempts`, [tokenHash(key)]);
    if (result.rows[0].attempts > limit) throw new AuthError('Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.', 429);
  }
  async issue(c: PoolClient, user: AuthUser, family = randomUUID(), expires?: string) {
    const access = token(), refresh = token();
    const result = await c.query(`INSERT INTO writer_studio.auth_sessions
      (user_id,family_id,access_hash,refresh_hash,access_expires_at,expires_at)
      VALUES ($1,$2,$3,$4,now()+interval '15 minutes',COALESCE($5::timestamptz,now()+interval '30 days'))
      RETURNING extract(epoch FROM access_expires_at)::bigint AS access_exp,extract(epoch FROM expires_at)::bigint AS refresh_exp`,
      [user.id, family, tokenHash(access), tokenHash(refresh), expires ?? null]);
    return { accessToken: access, refreshToken: refresh, expiresAt: Number(result.rows[0].access_exp),
      refreshExpiresAt: Number(result.rows[0].refresh_exp), authProvider: 'postgres' as const,
      user: { id: user.id, email: user.email, role: user.role } };
  }
  async login(emailInput: string, password: string) {
    const email = normalizeEmail(emailInput);
    await this.throttle('login:' + email, 12);
    const { rows } = await this.pool.query('SELECT * FROM writer_studio.auth_users WHERE email=$1', [email]);
    const user = rows[0] as AuthUser | undefined;
    const valid = await verifyPassword(password, user?.password_hash ?? null);
    if (!valid || !user || user.status !== 'active' || !user.email_verified) {
      await this.audit(this.pool, 'login_failed', user?.id);
      throw new AuthError('Email, mật khẩu hoặc trạng thái tài khoản không hợp lệ.');
    }
    return this.transaction(async c => {
      const current = (await c.query('SELECT * FROM writer_studio.auth_users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
      if (!current || current.password_hash !== user.password_hash || current.status !== 'active' || !current.email_verified) throw new AuthError('Tài khoản đã thay đổi. Vui lòng đăng nhập lại.');
      // Preserve existing credentials while upgrading their hash strength.
      // New/reset passwords still go through the stricter policy.
      if (supportedLegacyHash(current.password_hash))
        await c.query('UPDATE writer_studio.auth_users SET password_hash=$2,updated_at=now() WHERE id=$1', [user.id, await encodePassword(password)]);
      await this.audit(c, 'login', user.id);
      return this.issue(c, user);
    });
  }
  async refresh(refresh: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refresh)) throw new AuthError('Phiên đăng nhập không hợp lệ.');
    const result = await this.transaction(async c => {
      // Lock the user before session, matching reset/logout-all lock order.
      const found = (await c.query('SELECT user_id FROM writer_studio.auth_sessions WHERE refresh_hash=$1', [tokenHash(refresh)])).rows[0];
      if (!found) return null;
      const user = (await c.query('SELECT * FROM writer_studio.auth_users WHERE id=$1 FOR UPDATE', [found.user_id])).rows[0];
      const session = (await c.query('SELECT *,expires_at>now() AS live FROM writer_studio.auth_sessions WHERE refresh_hash=$1 FOR UPDATE', [tokenHash(refresh)])).rows[0];
      if (session.revoked_at) {
        await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id=$1', [session.family_id]);
        await this.audit(c, 'refresh_reuse_detected', found.user_id);
        return null; // Commit revocation, then reject outside transaction.
      }
      if (!session.live || user.status !== 'active' || !user.email_verified) return null;
      await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=now() WHERE id=$1', [session.id]);
      await this.audit(c, 'refresh', user.id);
      return this.issue(c, user, session.family_id, session.expires_at);
    });
    if (!result) throw new AuthError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    return result;
  }
  async authenticate(access: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(access)) throw new AuthError('Phiên đăng nhập không hợp lệ.');
    const result = await this.pool.query(`SELECT u.id,u.email,u.role FROM writer_studio.auth_users u
      JOIN writer_studio.auth_sessions s ON s.user_id=u.id WHERE s.access_hash=$1
      AND s.revoked_at IS NULL AND s.access_expires_at>now() AND s.expires_at>now()
      AND u.status='active' AND u.email_verified`, [tokenHash(access)]);
    if (!result.rows[0]) throw new AuthError('Phiên đăng nhập đã hết hạn.');
    return { ...result.rows[0], app_metadata: { role: result.rows[0].role } };
  }
  async logout(refresh: string) {
    await this.transaction(async c => {
      const result = await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE family_id IN (SELECT family_id FROM writer_studio.auth_sessions WHERE refresh_hash=$1) RETURNING user_id', [tokenHash(refresh)]);
      if (result.rows[0]) await this.audit(c, 'logout', result.rows[0].user_id);
    });
  }
  async logoutAll(userId: string) {
    await this.transaction(async c => {
      await c.query('SELECT id FROM writer_studio.auth_users WHERE id=$1 FOR UPDATE', [userId]);
      await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [userId]);
      await this.audit(c, 'logout_all', userId);
    });
  }
  async createEmailToken(userId: string, purpose: 'recovery' | 'verification') {
    const value = token();
    await this.pool.query("INSERT INTO writer_studio.auth_tokens(token_hash,user_id,purpose,expires_at) VALUES ($1,$2,$3,now()+interval '30 minutes')", [tokenHash(value), userId, purpose]);
    return value;
  }
  async consumeEmailToken(value: string, purpose: 'recovery' | 'verification', password?: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new AuthError('Link không hợp lệ.', 400);
    const passwordHash = purpose === 'recovery' ? await hashPassword(password ?? '') : null;
    return this.transaction(async c => {
      const found = (await c.query('SELECT user_id FROM writer_studio.auth_tokens WHERE token_hash=$1 AND purpose=$2', [tokenHash(value), purpose])).rows[0];
      if (!found) throw new AuthError('Link không hợp lệ hoặc đã hết hạn.', 400);
      await c.query('SELECT id FROM writer_studio.auth_users WHERE id=$1 FOR UPDATE', [found.user_id]);
      const used = await c.query('UPDATE writer_studio.auth_tokens SET used_at=now() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() RETURNING user_id', [tokenHash(value), purpose]);
      if (!used.rows[0]) throw new AuthError('Link không hợp lệ hoặc đã hết hạn.', 400);
      if (purpose === 'recovery') {
        await c.query('UPDATE writer_studio.auth_users SET password_hash=$2,updated_at=now() WHERE id=$1', [found.user_id, passwordHash]);
        await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [found.user_id]);
        await c.query("UPDATE writer_studio.auth_tokens SET used_at=COALESCE(used_at,now()) WHERE user_id=$1 AND purpose='recovery'", [found.user_id]);
      } else await c.query('UPDATE writer_studio.auth_users SET email_verified=true,updated_at=now() WHERE id=$1', [found.user_id]);
      await this.audit(c, purpose === 'recovery' ? 'password_reset' : 'email_verified', found.user_id);
    });
  }
}
