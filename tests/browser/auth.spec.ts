import { DEFAULT_CONFIG } from '../../src/lib/defaultData';
import { test, expect } from './browser-fixture';
test('PostgreSQL auth restores cookie session after reload without persisting tokens', async ({ page }) => {
  let refreshes = 0, logouts = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const payload = { authProvider: 'postgres', accessToken: 'ACCESS_TOKEN_SENTINEL', expiresAt: Math.floor(Date.now()/1000)+900, user: { id:'user',email:'user@example.com',role:'user' } };
    if(url.pathname === '/api/auth/config') return route.fulfill({ json: { provider:'postgres',allowSignup:false,passwordMin:12 } });
    if(url.pathname === '/api/auth/login') return route.fulfill({ json:payload,headers:{'Set-Cookie':'writer_refresh=COOKIE_SENTINEL; HttpOnly; SameSite=Strict; Path=/api/auth'} });
    if(url.pathname === '/api/auth/refresh'){
      refreshes++;
      expect(route.request().postDataJSON().refreshToken).toBeUndefined();
      expect(route.request().headers().cookie).toContain('writer_refresh=COOKIE_SENTINEL');
      return route.fulfill({json:payload});
    }
    if(url.pathname === '/api/auth/logout'){logouts++;return route.fulfill({json:{ok:true},headers:{'Set-Cookie':'writer_refresh=; Max-Age=0; Path=/api/auth'}});}
    return route.fallback();
  });
  await page.goto('/?auth');
  await page.getByLabel('Email',{exact:true}).fill('user@example.com');
  await page.getByLabel(/^(Mật khẩu|Password)$/).fill('long-enough-password');
  await page.getByRole('button',{name:/^(Đăng nhập|Sign in)$/}).click();
  await expect(page.getByText('user@example.com',{exact:true})).toBeVisible();
  const stored=await page.evaluate(()=>localStorage.getItem('writer:auth-session'));
  expect(stored).toContain('"authProvider":"postgres"');
  expect(stored).not.toContain('ACCESS_TOKEN_SENTINEL');
  expect(stored).not.toContain('COOKIE_SENTINEL');
  expect(await page.evaluate(()=>document.cookie)).not.toContain('writer_refresh');
  await page.reload();
  await expect(page.getByText('user@example.com',{exact:true})).toBeVisible();
  expect(refreshes).toBe(1);
  await page.getByRole('button',{name:'Logout fixture'}).click();
  await expect(page.getByLabel('Email',{exact:true})).toBeVisible();
  expect(logouts).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem('writer:auth-session'))).toBeNull();
});
test('Email confirmation submits one-time token explicitly and clears URL fragment', async ({page})=>{
  let confirmations=0;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(url.pathname==='/api/auth/config')return route.fulfill({json:{provider:'postgres',allowSignup:false,passwordMin:12}});
    if(url.pathname==='/api/auth/verify-email'){
      expect(route.request().postDataJSON().token).toBe('ONE_TIME_TOKEN');
      confirmations++;return route.fulfill({json:{message:'Email verified fixture'}});
    }
    return route.fallback();
  });
  await page.goto('/?auth#type=verification&access_token=ONE_TIME_TOKEN');
  await expect(page).not.toHaveURL(/ONE_TIME_TOKEN/);
  expect(confirmations).toBe(0);
  await page.getByRole('button',{name:/^(Xác nhận email|Verify email)$/}).click();
  await expect(page.getByRole('status')).toHaveText('Email verified fixture');
  expect(confirmations).toBe(1);
});

test('App keeps the sign-in form hidden while a stored cookie session is refreshed', async ({page}) => {
 const user = { id:'user',email:'user@example.com',role:'user' };
 let release!: () => void;
 const pending = new Promise<void>(resolve => { release = resolve; });
 await page.addInitScript(user => {
  localStorage.setItem('writer:auth-session', JSON.stringify({authProvider:'postgres',accessToken:'',expiresAt:null,user}));
 }, user);
 await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') return route.abort();
  if (url.pathname === '/api/auth/refresh') {
   await pending;
   return route.fulfill({json:{authProvider:'postgres',accessToken:'test-access',expiresAt:null,user}});
  }
  if (url.pathname === '/api/config') return route.fulfill({json:{...DEFAULT_CONFIG,railwayUrl:url.origin}});
  if (['/api/articles','/api/files','/api/content-plans'].includes(url.pathname)) return route.fulfill({json:[]});
  return route.fallback();
 });
 await page.goto('/?app-auth');
 try {
  await expect(page.getByText(/Đang tải Writer Studio|Loading Writer Studio/)).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toHaveCount(0);
  release();
  await expect(page.getByRole('button',{name:'Writer Studio',exact:true})).toBeVisible();
  await expect(page.getByLabel('Email',{exact:true})).toHaveCount(0);
 } finally { release(); }
});
