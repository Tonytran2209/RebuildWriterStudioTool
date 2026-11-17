import type { Page } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/lib/defaultData';
import { test, expect } from './browser-fixture';

const now = new Date().toISOString();
const pass = (id: string) => ({ id, label: 'Check ' + id, kind: 'semantic', status: 'pass', reason: '', autoFixAllowed: false });
const articles = [
  { id: 'a-approved', title: 'Approved article', topic: 'Approved article', currentStep: 4, status: 'review', createdAt: now, updatedAt: now,
    contentPlanId: 'plan-1', contentPlanItemId: 'i1', contentPlanInput: 'x', activityKind: 'batch', activityId: 'batch-1', batchStatus: 'completed',
    selectedCoreIdeaId: 'x', coreIdeaSuggestions: [{ id: 'x', title: 'Idea X', angleLabel: 'Decision guide', rating: { overall: 9.2 } }, { id: 'y', title: 'Idea Y', angleLabel: 'Myth', rating: { overall: 7.5 } }],
    outlineStructure: { id: 'comparison', name: 'Comparison form', sourceId: 'outline-md', sourceHash: 'h' }, outline: [{ id: 's', heading: 'OUTLINE_SENTINEL heading', notes: 'Section notes', level: 'h2' }], draft: '# Approved article\n\nREADING_SENTINEL body text.',
    qualityReport: { version: 11, status: 'pass', checkedAt: now, articleSpecFingerprint: '', checks: Array.from({ length: 10 }, (_, i) => pass('c' + i)) } },
  { id: 'a-failed', title: 'Failed article', currentStep: 2, status: 'in_progress', createdAt: now, updatedAt: now,
    contentPlanId: 'plan-1', contentPlanItemId: 'i2', contentPlanInput: 'x', activityKind: 'batch', activityId: 'batch-1', batchStatus: 'failed', batchError: 'timeout' },
];
const plan = { id: 'plan-1', name: 'Plan One', status: 'active', version: 1, sourceFingerprint: '', totalArticles: 2, comparisonCount: 2, editorialCount: 0, reviewCount: 0, createdAt: now, updatedAt: now };
const structureFile = { id: 'outline-md', name: 'Outline forms.md', category: 'rules', fileType: 'md', size: '1 KB', uploadedAt: now, scanStatus: 'ready',
  content: '```outline-structures\n' + JSON.stringify({ version: 1, structures: [{ id: 'comparison', name: 'Comparison form', description: 'Compare two formats', useWhen: 'Two options', outlineInstructions: 'o', draftInstructions: 'd' }] }) + '\n```' };

async function mockApp(page: Page, role: 'admin' | 'user' = 'admin') {
  const user = { id: role, email: role + '@example.com', role };
  const log = { reruns: [] as any[], puts: [] as any[], configs: [] as any[], created: [] as any[], started: [] as string[], imported: [] as any[] };
  await page.addInitScript(user => localStorage.setItem('writer:auth-session', JSON.stringify({ authProvider: 'postgres', accessToken: '', expiresAt: null, user })), user);
  const config = { ...DEFAULT_CONFIG, stepConfigs: { ...DEFAULT_CONFIG.stepConfigs, 3: { ...DEFAULT_CONFIG.stepConfigs[3], fileAccess: { kb: [], rules: ['outline-md'] } } } };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const method = route.request().method();
    if (url.pathname === '/api/auth/refresh') return route.fulfill({ json: { authProvider: 'postgres', accessToken: 'tok', expiresAt: null, user } });
    if (url.pathname === '/api/config' && method === 'POST') { log.configs.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/api/config') return route.fulfill({ json: { ...config, railwayUrl: url.origin } });
    if (url.pathname === '/api/articles' && method === 'GET') return route.fulfill({ json: articles });
    if (url.pathname === '/api/articles' && method === 'POST') { const body = route.request().postDataJSON(); log.created.push(body); return route.fulfill({ json: { ok: true, article: body } }); }
    const rerun = url.pathname.match(/^\/api\/articles\/([^/]+)\/rerun$/);
    if (rerun) { const body = route.request().postDataJSON(); log.reruns.push({ id: rerun[1], ...body }); return route.fulfill({ status: 202, json: { ok: true, article: { ...articles[0], qualityReport: null, batchStatus: 'queued' } } }); }
    if (url.pathname.startsWith('/api/articles/') && method === 'PUT') { const patch = route.request().postDataJSON(); log.puts.push(patch); return route.fulfill({ json: { ok: true, article: { ...articles[0], ...patch } } }); }
    if (url.pathname === '/api/content-plans/import') { log.imported.push(route.request().postDataJSON()); return route.fulfill({ json: { plan: { ...plan, id: 'plan-new', name: 'New plan', totalArticles: 3 } } }); }
    if (url.pathname === '/api/content-plans/plan-new/classify') return route.fulfill({ json: { plan: { ...plan, id: 'plan-new', name: 'New plan', totalArticles: 3, items: [
      { id: 'n1', title: 'A vs B', keywords: ['a vs b'], type: 'comparison-seo', sourceLine: 'A vs B' },
      { id: 'n2', title: 'C vs D', keywords: [], type: 'comparison-seo', sourceLine: 'C vs D' },
      { id: 'n3', title: 'Why E matters', keywords: [], type: 'needs-review', sourceLine: 'Why E matters' },
    ] } } });
    if (url.pathname === '/api/content-plans') return route.fulfill({ json: [plan] });
    if (url.pathname === '/api/files') return route.fulfill({ json: [structureFile] });
    const start = url.pathname.match(/^\/api\/batches\/([^/]+)\/start$/);
    if (start) { log.started.push(decodeURIComponent(start[1])); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname.startsWith('/api/batches/')) return route.fulfill({ json: { articles: [] } });
    return route.fallback();
  });
  await page.goto('/?app-auth');
  await expect(page.getByRole('navigation', { name: /Điều hướng chính|Main navigation/ })).toBeAttached();
  return log;
}
const goHash = (page: Page, hash: string) => page.evaluate(h => { location.hash = h; }, hash);

test('CRM (demo UI): kanban, table, record, review and pipeline settings on real records', async ({ page }) => {
  const log = await mockApp(page);
  const failed = page.getByRole('region', { name: 'Failed (No-pass)' });
  await expect(failed.getByText('Failed article')).toBeVisible();
  await expect(failed.getByRole('button', { name: 'Retry G1' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Completed' }).getByText('Approved article')).toBeVisible();

  await page.getByRole('button', { name: 'Table' }).click();
  const table = page.locator('table.tbl');
  await expect(table.getByText('100%')).toBeVisible();
  await expect(table.getByText('AI Approved')).toBeVisible();
  await table.getByRole('link', { name: /Approved article/ }).click();

  await expect(page).toHaveURL(/#\/object\/articles\/a-approved/);
  await expect(page.getByText('READING_SENTINEL body text.')).toBeVisible();
  await page.getByRole('tab', { name: /AI Review/ }).click();
  await expect(page.locator('.kpi').first()).toHaveText('100%');

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Review' });
  await panel.getByRole('button', { name: 'Request Revision' }).click();
  expect(log.puts).toHaveLength(0);
  await panel.getByLabel(/Nhận xét|Comment/).fill('Tighten the intro');
  await panel.getByRole('button', { name: 'Request Revision' }).click();
  await expect.poll(() => log.puts.length).toBe(1);
  expect(log.puts[0].humanReview).toMatchObject({ status: 'needs_revision', comment: 'Tighten the intro', reviewer: 'admin@example.com' });

  await goHash(page, '/settings/pipeline');
  const threshold = page.getByLabel('Threshold (%)');
  await threshold.fill('85');
  await threshold.press('Enter');
  await expect.poll(() => log.configs.length).toBe(1);
  expect(log.configs[0].pipeline.threshold).toBe(85);
});

test('CRM Add Plan imports, classifies, splits into batches and starts them', async ({ page }) => {
  const log = await mockApp(page);
  await goHash(page, '/objects/plans');
  await page.locator('.ph-actions').getByRole('button', { name: 'Add Plan' }).click();
  const panel = page.getByRole('dialog', { name: 'Add Plan' });
  await panel.getByLabel(/Tên Content Plan|Content Plan name/).fill('New plan');
  await panel.getByLabel('Per batch').fill('1');
  await panel.getByLabel('Topics').fill('A vs B\nC vs D\nWhy E matters');
  await expect(panel.getByText('3 batch')).toBeVisible();
  await panel.getByRole('button', { name: 'Generate' }).click();
  await expect(log.created).toHaveLength(0);
  await panel.getByRole('button', { name: /Chọn dạng cấu trúc|Select the right structure/ }).click();
  await panel.getByRole('option', { name: /Comparison form/ }).click();
  await panel.getByRole('button', { name: 'Generate' }).click();
  await expect(page).toHaveURL(/#\/object\/plans\/plan-new/);
  expect(log.imported[0]).toMatchObject({ name: 'New plan', sourceType: 'paste', content: 'A vs B\nC vs D\nWhy E matters' });
  expect(log.created).toHaveLength(3);
  expect(log.created.map(a => a.activityKind)).toEqual(['batch', 'batch', 'batch']);
  expect(new Set(log.created.map(a => a.activityId)).size).toBe(3);
  expect(log.created[2].activityType).toBe('editorial-originality');
  expect(log.created[0].outlineStructure?.id).toBe('comparison');
  expect(log.started).toHaveLength(3);
});

test('CRM manual mode uses the demo layout and re-runs gates through the pipeline', async ({ page }) => {
  const log = await mockApp(page);
  await goHash(page, '/object/articles/a-approved?tab=manual');
  await expect(page.getByRole('tab', { name: /Chế độ thủ công|Manual mode/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('radio', { name: /Idea X/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Idea Y/ })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: /OUTLINE_SENTINEL heading/ }).click();
  await expect(page.getByText('Section notes')).toBeVisible();
  await expect(page.getByLabel(/Bản nháp|Draft/)).toHaveValue(/READING_SENTINEL/);
  await expect(page.locator('.outline-picker')).toHaveCount(0);
  await page.getByRole('button', { name: /Chấm lại AI|Re-check AI/ }).click();
  await expect.poll(() => log.reruns.length).toBe(1);
  expect(log.reruns[0]).toEqual({ id: 'a-approved', gate: 4 });
});
