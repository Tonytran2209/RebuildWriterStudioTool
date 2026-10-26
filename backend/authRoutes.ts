import express from 'express';
import nodemailer from 'nodemailer';
import { AuthError, AuthService, authProvider, hashPassword, normalizeEmail, tokenHash } from './authService.ts';
export const REFRESH_COOKIE = 'writer_refresh';
export function appOrigin() {
  const url = new URL(process.env.AUTH_APP_ORIGIN ?? '');
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.hostname === 'localhost')) throw new Error('AUTH_APP_ORIGIN must be HTTPS');
  return url.origin;
}
export function assertAuthConfig() {
  if (authProvider() === 'postgres') appOrigin();
}
export function cookieToken(req: express.Request) {
  const matches = (req.headers.cookie ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(REFRESH_COOKIE + '='));
  if (matches.length !== 1) return '';
  return matches[0].slice(REFRESH_COOKIE.length + 1);
}
export function csrfAllowed(origin: string | undefined) { return origin === appOrigin(); }
const cookieOptions = () => ({ httpOnly: true, secure: new URL(appOrigin()).protocol === 'https:', sameSite: 'strict' as const, path: '/api/auth' });
function sendSession(res: express.Response, session: Awaited<ReturnType<AuthService['login']>>) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions(), maxAge: Math.max(0, session.refreshExpiresAt * 1000 - Date.now()) });
  const { refreshToken, refreshExpiresAt, ...payload } = session;
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
}
function mailTransport() {
  if (!process.env.AUTH_SMTP_HOST || !process.env.AUTH_MAIL_FROM || !process.env.AUTH_SMTP_USER || !process.env.AUTH_SMTP_PASSWORD) throw new AuthError('Email chưa được cấu hình. Vui lòng liên hệ quản trị viên.', 503);
  return nodemailer.createTransport({
    host: process.env.AUTH_SMTP_HOST, port: Number(process.env.AUTH_SMTP_PORT ?? 465),
    secure: (process.env.AUTH_SMTP_PORT ?? '465') === '465', requireTLS: true,
    auth: { user: process.env.AUTH_SMTP_USER, pass: process.env.AUTH_SMTP_PASSWORD },
    connectionTimeout: 10000, socketTimeout: 20000,
  });
}
export async function sendAuthEmail(service: AuthService, userId: string, email: string, purpose: 'recovery' | 'verification') {
  const transport = mailTransport();
  const value = await service.createEmailToken(userId, purpose);
  const url = appOrigin() + '/#type=' + purpose + '&access_token=' + encodeURIComponent(value);
  try {
    await transport.sendMail({ from: process.env.AUTH_MAIL_FROM, to: email,
      subject: purpose === 'recovery' ? 'Writer Studio: đặt lại mật khẩu' : 'Writer Studio: xác nhận email',
      text: `Mở liên kết sau để ${purpose === 'recovery' ? 'đặt lại mật khẩu' : 'xác nhận email'}: ${url}\nLiên kết hết hạn sau 30 phút và chỉ dùng một lần. Nếu không yêu cầu, hãy bỏ qua email này.` });
  } catch {
    await service.pool.query('DELETE FROM writer_studio.auth_tokens WHERE token_hash=$1', [tokenHash(value)]);
    throw new AuthError('Không thể gửi email. Vui lòng thử lại sau.', 503);
  } finally { transport.close(); }
}
export function postgresAuthRouter(service = new AuthService()) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (authProvider() !== 'postgres') return next('router');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!csrfAllowed(req.header('origin'))) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    next();
  });
  const route = (name: string, handler: (req: express.Request, res: express.Response) => Promise<any>) =>
    router.post(name, async (req, res) => {
      try {
        // Do not trust client-supplied forwarded IPs. AUTH_TRUST_PROXY_HOPS must
        // match the actual ingress topology before relying on req.ip.
        await service.throttle('ip:' + (req.ip ?? req.socket.remoteAddress ?? 'unknown'), 150);
        await handler(req, res);
      } catch (e) {
        if (e instanceof AuthError) return res.status(e.status).json({ error: e.message });
        console.error('Auth operation failed', (e as any)?.code ?? 'INTERNAL');
        res.status(503).json({ error: 'Dịch vụ đăng nhập tạm thời không khả dụng.' });
      }
    });
  route('/login', async (req, res) => {
    const session = await service.login(String(req.body?.email ?? ''), String(req.body?.password ?? ''));
    sendSession(res, session);
  });
  route('/refresh', async (req, res) => sendSession(res, await service.refresh(cookieToken(req))));
  route('/logout', async (req, res) => {
    await service.logout(cookieToken(req));
    res.clearCookie(REFRESH_COOKIE, cookieOptions()); res.json({ ok: true });
  });
  route('/logout-all', async (req, res) => {
    const user = await service.authenticate(req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
    await service.logoutAll(user.id);
    res.clearCookie(REFRESH_COOKIE, cookieOptions()); res.json({ ok: true });
  });
  route('/signup', async (req, res) => {
    if (process.env.AUTH_ALLOW_SIGNUP !== 'true') throw new AuthError('Đăng ký công khai đang đóng. Vui lòng liên hệ quản trị viên.', 403);
    mailTransport().close();
    const email = normalizeEmail(String(req.body?.email ?? ''));
    await service.throttle('email:' + email, 5);
    const hash = await hashPassword(String(req.body?.password ?? ''));
    const user = await service.transaction(async c => {
      const rows = await c.query('INSERT INTO writer_studio.auth_users(email,password_hash) VALUES ($1,$2) ON CONFLICT(email) DO NOTHING RETURNING id', [email, hash]);
      if (rows.rows[0]) await service.audit(c, 'signup', rows.rows[0].id);
      return rows.rows[0];
    });
    if (user) await sendAuthEmail(service, user.id, email, 'verification');
    res.status(201).json({ message: 'Nếu đủ điều kiện đăng ký, email xác minh đã được gửi. Bạn cũng có thể dùng chức năng gửi lại email xác minh.' });
  });
  for (const [name, purpose] of [['/forgot-password', 'recovery'], ['/resend-verification', 'verification']] as const) {
    route(name, async (req, res) => {
      mailTransport().close();
      const email = normalizeEmail(String(req.body?.email ?? ''));
      await service.throttle('email:' + email, 5);
      const user = (await service.pool.query('SELECT id,email_verified FROM writer_studio.auth_users WHERE email=$1 AND status=$2', [email, 'active'])).rows[0];
      if (user && (purpose === 'verification' ? !user.email_verified : user.email_verified)) await sendAuthEmail(service, user.id, email, purpose);
      res.json({ message: 'Nếu tài khoản đủ điều kiện, email đã được gửi.' });
    });
  }
  route('/reset-password', async (req, res) => {
    await service.consumeEmailToken(req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '', 'recovery', String(req.body?.password ?? ''));
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    res.json({ message: 'Đã đặt lại mật khẩu. Hãy đăng nhập lại.' });
  });
  route('/verify-email', async (req, res) => {
    await service.consumeEmailToken(String(req.body?.token ?? ''), 'verification');
    res.json({ message: 'Email đã xác minh. Bạn có thể đăng nhập.' });
  });
  route('/admin/user', async (req, res) => {
    const actor = await service.authenticate(req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
    if (actor.role !== 'admin') throw new AuthError('Chỉ admin được quản lý tài khoản.', 403);
    const id = String(req.body?.id ?? '');
    const role = req.body?.role, status = req.body?.status;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['user','admin'].includes(role) || !['active','disabled'].includes(status)) throw new AuthError('Thông tin tài khoản không hợp lệ.', 400);
    await service.transaction(async c => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('writer-auth-admin'))");
      const currentActor = (await c.query('SELECT role,status FROM writer_studio.auth_users WHERE id=$1 FOR UPDATE', [actor.id])).rows[0];
      if (currentActor?.role !== 'admin' || currentActor?.status !== 'active') throw new AuthError('Không đủ quyền.', 403);
      const target = (await c.query('SELECT * FROM writer_studio.auth_users WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!target) throw new AuthError('Không tìm thấy tài khoản.', 404);
      if (target.role === 'admin' && target.status === 'active' && (role !== 'admin' || status !== 'active')) {
        const admins = await c.query("SELECT id FROM writer_studio.auth_users WHERE role='admin' AND status='active' AND email_verified");
        if (admins.rows.length <= 1) throw new AuthError('Không thể vô hiệu hóa admin cuối cùng.', 409);
      }
      await c.query('UPDATE writer_studio.auth_users SET role=$2,status=$3,updated_at=now() WHERE id=$1', [id, role, status]);
      await c.query('UPDATE writer_studio.auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1', [id]);
      await service.audit(c, 'user_updated_by_admin:' + actor.id, id);
    });
    res.json({ ok: true });
  });
  router.use((_req, res) => res.status(404).json({ error: 'Unknown auth operation' }));
  return router;
}
