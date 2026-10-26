import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { AuthService, hashPassword, verifyPassword, tokenHash, authProvider } from './authService.ts';
import { migrateAuth } from './authMigrate.ts';
import { importAuth, authScope } from './authImport.ts';
import { csrfAllowed, postgresAuthRouter } from './authRoutes.ts';
import express from 'express';

function poolFor(db: PGlite) {
  const query = async (sql: string, values?: any[]) => {
    if (sql.startsWith('CREATE TABLE writer_studio.auth_users')) { await db.exec(sql); return { rows: [], rowCount: 0 }; }
    const r = await db.query(sql, values); return { ...r, rowCount: r.rows.length || r.affectedRows };
  };
  return { query, connect: async () => ({ query, release() {} }), end: async () => {} } as any;
}
test('Postgres auth: hashing, login, refresh reuse, reset, verification, disabled account, rate limit', async () => {
  const db = new PGlite();
  const pool = poolFor(db), service = new AuthService(pool);
  try {
    await migrateAuth(pool); await migrateAuth(pool);
    const hash = await hashPassword('long-enough-password');
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('long-enough-password', hash), true);
    await assert.rejects(() => hashPassword('short'), /12/);
    const uid = '00000000-0000-4000-8000-000000000001';
    await db.query("INSERT INTO writer_studio.auth_users(id,email,password_hash,email_verified,role) VALUES ($1,'owner@example.com',$2,true,'admin')", [uid, await bcrypt.hash('long-enough-password', 4)]);
    await assert.rejects(() => service.login('owner@example.com', 'wrong'), /không hợp lệ/);
    const first = await service.login('OWNER@example.com', 'long-enough-password');
    assert.equal(first.user.role, 'admin');
    const saved = (await db.query<any>('SELECT password_hash FROM writer_studio.auth_users')).rows[0].password_hash;
    assert.ok(saved.startsWith('scrypt-v1$'));
    assert.equal((await service.authenticate(first.accessToken)).id, uid);
    const second = await service.refresh(first.refreshToken);
    await assert.rejects(() => service.authenticate(first.accessToken));
    assert.equal((await service.authenticate(second.accessToken)).id, uid);
    await assert.rejects(() => service.refresh(first.refreshToken));
    await assert.rejects(() => service.authenticate(second.accessToken)); // replay revokes family
    const third = await service.login('owner@example.com', 'long-enough-password');
    await service.logout(third.refreshToken);
    await assert.rejects(() => service.authenticate(third.accessToken));
    const fourth = await service.login('owner@example.com', 'long-enough-password');
    const fifth = await service.login('owner@example.com', 'long-enough-password');
    await service.logoutAll(uid);
    await assert.rejects(() => service.authenticate(fourth.accessToken));
    await assert.rejects(() => service.authenticate(fifth.accessToken));
    const sixth = await service.login('owner@example.com', 'long-enough-password');
    const reset = await service.createEmailToken(uid, 'recovery');
    await service.consumeEmailToken(reset, 'recovery', 'replacement-password');
    await assert.rejects(() => service.consumeEmailToken(reset, 'recovery', 'another-password'));
    await assert.rejects(() => service.authenticate(sixth.accessToken));
    await assert.rejects(() => service.login('owner@example.com', 'long-enough-password'));
    const fresh = await service.login('owner@example.com', 'replacement-password');
    await db.exec("UPDATE writer_studio.auth_sessions SET access_expires_at=now()-interval '1 second'");
    await assert.rejects(() => service.authenticate(fresh.accessToken));
    await db.exec("UPDATE writer_studio.auth_sessions SET expires_at=now()-interval '1 second'");
    await assert.rejects(() => service.refresh(fresh.refreshToken));
    const expired = await service.createEmailToken(uid, 'recovery');
    await db.query("UPDATE writer_studio.auth_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [tokenHash(expired)]);
    await assert.rejects(() => service.consumeEmailToken(expired, 'recovery', 'replacement-password'));
    await db.exec("UPDATE writer_studio.auth_users SET email_verified=false");
    await assert.rejects(() => service.login('owner@example.com', 'replacement-password'));
    const verify = await service.createEmailToken(uid, 'verification');
    await service.consumeEmailToken(verify, 'verification');
    await assert.rejects(() => service.consumeEmailToken(verify, 'verification'));
    await db.exec("UPDATE writer_studio.auth_users SET status='disabled'");
    await assert.rejects(() => service.login('owner@example.com', 'replacement-password'));
    await service.throttle('test', 1); await assert.rejects(() => service.throttle('test', 1), /15 phút/);
    const raw = JSON.stringify((await db.query('SELECT * FROM writer_studio.auth_sessions')).rows);
    assert.ok(!raw.includes(first.refreshToken) && !raw.includes(first.accessToken));
  } finally { await db.close(); }
});
test('Auth HTTP: origin protection, secure cookie, no refresh token in JSON, role enforcement', async () => {
  const db = new PGlite(), pool = poolFor(db), service = new AuthService(pool);
  const oldProvider = process.env.AUTH_PROVIDER, oldOrigin = process.env.AUTH_APP_ORIGIN;
  process.env.AUTH_PROVIDER = 'postgres'; process.env.AUTH_APP_ORIGIN = 'https://writer.example.com';
  await migrateAuth(pool);
  await db.query("INSERT INTO writer_studio.auth_users(email,password_hash,email_verified) VALUES ('user@example.com',$1,true)", [await hashPassword('long-enough-password')]);
  const app = express(); app.use(express.json()); app.use('/api/auth', postgresAuthRouter(service));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + (server.address() as any).port;
  try {
    assert.equal(authProvider(), 'postgres');
    assert.equal(csrfAllowed('https://attacker.example'), false);
    const send = (route: string, body: unknown, headers: Record<string,string> = {}) => fetch(base + '/api/auth/' + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://writer.example.com', ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await send('login', {}, { Origin: 'https://attacker.example' })).status, 403);
    const login = await send('login', { email: 'user@example.com', password: 'long-enough-password' });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
    const session = await login.json() as any;
    assert.equal(session.refreshToken, undefined);
    assert.equal(session.user.role, 'user');
    assert.equal((await send('admin/user', { id: session.user.id, role: 'admin', status: 'active' }, { Authorization: 'Bearer ' + session.accessToken })).status, 403);
    assert.equal((await send('refresh', {}, { Cookie: cookie.split(';')[0] })).status, 200);
    assert.equal((await send('signup', { email: 'new@example.com', password: 'long-enough-password' })).status, 403);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (oldProvider === undefined) delete process.env.AUTH_PROVIDER; else process.env.AUTH_PROVIDER = oldProvider;
    if (oldOrigin === undefined) delete process.env.AUTH_APP_ORIGIN; else process.env.AUTH_APP_ORIGIN = oldOrigin;
    await db.close();
  }
});
test('Auth migration/import: dry-run, preserve ID/hash, no overwrite, ban and MFA protection', async () => {
  const source = new PGlite(), target = new PGlite();
  const sourceEnv = process.env.SOURCE_DATABASE_URL, targetEnv = process.env.DATABASE_URL;
  const folder = await mkdtemp(path.join(tmpdir(), 'auth-import-'));
  const uid = '00000000-0000-4000-8000-000000000001';
  try {
    await migrateAuth(poolFor(target));
    await source.exec('CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,banned_until timestamptz,deleted_at timestamptz); CREATE TABLE auth.mfa_factors(user_id uuid,status text)');
    const password = await bcrypt.hash('legacy-password', 4);
    await source.query("INSERT INTO auth.users VALUES ($1,'owner@example.com',$2,now(),now(),'infinity',NULL)", [uid, password]);
    process.env.SOURCE_DATABASE_URL = 'postgres://unused@source/db';
    process.env.DATABASE_URL = 'postgres://unused@target/db';
    const scope = { project: 'writer-studio', sourceIdentity: 'source:5432/db', targetIdentity: 'target:5432/db', users: [{ id: uid, email: 'owner@example.com', role: 'admin', ownershipEvidence: 'Explicit owner fixture' }] };
    assert.throws(() => authScope({ ...scope, users: [{ ...scope.users[0], ownershipEvidence: '' }] }));
    const file = path.join(folder, 'scope.json'); await writeFile(file, JSON.stringify(scope));
    const factory = (url?: string) => poolFor(url === process.env.SOURCE_DATABASE_URL ? source : target);
    await source.query("INSERT INTO auth.mfa_factors VALUES ($1,'verified')", [uid]);
    await assert.rejects(() => importAuth(['--scope=' + file], factory), /MFA/);
    await source.exec('DELETE FROM auth.mfa_factors');
    await importAuth(['--scope=' + file], factory);
    assert.equal((await target.query('SELECT * FROM writer_studio.auth_users')).rows.length, 0);
    await importAuth(['--scope=' + file, '--apply'], factory);
    const saved = (await target.query<any>('SELECT * FROM writer_studio.auth_users')).rows[0];
    assert.equal(saved.id, uid); assert.equal(saved.password_hash, password); assert.equal(saved.status, 'disabled');
    await assert.rejects(() => importAuth(['--scope=' + file, '--apply'], factory), /refusing overwrite/);
    assert.equal((await source.query('SELECT * FROM auth.users')).rows.length, 1);
  } finally {
    if (sourceEnv === undefined) delete process.env.SOURCE_DATABASE_URL; else process.env.SOURCE_DATABASE_URL = sourceEnv;
    if (targetEnv === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = targetEnv;
    await source.close(); await target.close(); await rm(folder, { recursive: true, force: true });
  }
});
