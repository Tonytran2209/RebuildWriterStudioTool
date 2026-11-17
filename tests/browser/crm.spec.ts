import { DEFAULT_CONFIG } from '../../src/lib/defaultData';
import { test, expect } from './browser-fixture';

const now = '2026-11-17T08:00:00.000Z';
const pass = (id: string) => ({ id, label: 'Check ' + id, kind: 'semantic', status: 'pass', reason: '', autoFixAllowed: false });
const articles = [
  { id: 'a-approved', title: 'Approved article', topic: 'Approved article', currentStep: 4, status: 'review', createdAt: now, updatedAt: now,
    contentPlanId: 'plan-1', contentPlanItemId: 'i1', contentPlanInput: 'x', activityKind: 'batch', activityId: 'batch-1', batchStatus: 'completed',
    selectedCoreIdeaId: 'x', outline: [{ id: 's', heading: 'H', notes: '', level: 'h2' }], draft: '# Approved article\n\nREADING_SENTINEL body text.',
    qualityReport: { version: 11, status: 'pass', checkedAt: now, articleSpecFingerprint: '', checks: Array.from({ length: 10 }, (_, i) => pass('c' + i)) } },
  { id: 'a-failed', title: 'Failed article', currentStep: 2, status: 'in_progress', createdAt: now, updatedAt: now,
    contentPlanId: 'plan-1', contentPlanItemId: 'i2', contentPlanInput: 'x', activityKind: 'batch', activityId: 'batch-1', batchStatus: 'failed', batchError: 'timeout' },
];

test('CRM shell: table, kanban, record, human review and pipeline settings', async ({ page }) => {
  const user = { id: 'admin', email: 'admin@example.com', role: 'admin' };
  const puts: any[] = [], configs: any[] = [];
  await page.addInitScript(user => localStorage.setItem('writer:auth-session', JSON.stringify({ authProvider: 'postgres', accessToken: '', expiresAt: null, user })), user);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const method = route.request().method();
    if (url.pathname === '/api/auth/refresh') return route.fulfill({ json: { authProvider: 'postgres', accessToken: 'tok', expiresAt: null, user } });
    if (url.pathname === '/api/config' && method === 'POST') { configs.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/api/config') return route.fulfill({ json: { ...DEFAULT_CONFIG, railwayUrl: url.origin } });
    if (url.pathname === '/api/articles' && method === 'GET') return route.fulfill({ json: articles });
    if (url.pathname.startsWith('/api/articles/') && method === 'PUT') {
      const patch = route.request().postDataJSON(); puts.push(patch);
      return route.fulfill({ json: { ok: true, article: { ...articles[0], ...patch } } });
    }
    if (url.pathname === '/api/content-plans') return route.fulfill({ json: [{ id: 'plan-1', name: 'Plan One', status: 'active', version: 1, sourceFingerprint: '', totalArticles: 2, comparisonCount: 2, editorialCount: 0, reviewCount: 0, createdAt: now, updatedAt: now }] });
    if (url.pathname === '/api/files') return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/api/batches/')) return route.fulfill({ json: { articles } });
    return route.fallback();
  });
  await page.goto('/?app-auth');

  const nav = page.getByRole('navigation', { name: /Điều hướng chính|Main navigation/ });
  await expect(nav).toBeAttached();
  const menu = page.getByRole('button', { name: /Mở menu|Open menu/ });
  const openNav = async () => { if (await menu.isVisible()) await menu.click(); };
  const table = page.locator('table.tbl');
  await expect(table.getByRole('link', { name: 'Approved article' })).toBeVisible();
  await expect(table.getByText(/AI duyệt · 100%|AI approved · 100%/)).toBeVisible();
  await expect(table.getByText('Failed', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Kanban' }).click();
  const failedColumn = page.getByRole('region', { name: 'Failed' });
  await expect(failedColumn.getByText('Failed article')).toBeVisible();
  await expect(failedColumn.getByRole('button', { name: 'Retry' })).toBeVisible();
  await page.getByRole('region', { name: 'AI Approval' }).getByRole('button', { name: 'Approved article' }).click();

  await expect(page).toHaveURL(/#\/article\/a-approved/);
  await expect(page.getByText('READING_SENTINEL body text.')).toBeVisible();
  await page.getByRole('tab', { name: 'AI Review' }).click();
  await expect(page.locator('.score')).toHaveText('100%');

  await openNav();
  await nav.getByRole('button', { name: /Review Workspace/ }).click();
  await page.locator('table.tbl').getByText('Approved article').click();
  await page.getByRole('button', { name: 'Request Revision' }).click();
  expect(puts).toHaveLength(0);
  await page.getByLabel(/Nhận xét|Comment/).fill('Tighten the intro');
  await page.getByRole('button', { name: 'Request Revision' }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0].humanReview).toMatchObject({ status: 'needs_revision', comment: 'Tighten the intro', reviewer: 'admin@example.com' });

  await openNav();
  await nav.getByRole('button', { name: /Cài đặt|Settings/ }).click();
  await page.getByLabel(/Ngưỡng AI Approval|AI approval threshold/).fill('85');
  await page.getByRole('button', { name: /^(Lưu|Save)$/ }).click();
  await expect.poll(() => configs.length).toBe(1);
  expect(configs[0].pipeline.threshold).toBe(85);

  await openNav();
  await nav.getByRole('button', { name: /Giao diện cũ|Classic UI/ }).click();
  await expect(page.getByRole('button', { name: 'Writer Studio', exact: true })).toBeAttached();
});
