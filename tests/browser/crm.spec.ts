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
    batchStepRuns: [{ key: 'outline', label: 'Lập outline', startedAt: now, endedAt: now, status: 'completed' }, { key: 'draft', label: 'Viết draft', startedAt: now, endedAt: now, status: 'completed' }],
    aiUsageByStep: { 4: [{ id: 'u1', step: 4, provider: 'openai', model: 'MODEL_SENTINEL', inputTokens: 1200, outputTokens: 800, totalTokens: 2000, costUsd: 0.0123, cacheHit: false, calledAt: now, purpose: 'generation', durationMs: 4000,
      trace: { input: 'INPUT_SENTINEL prompt', output: 'OUTPUT_SENTINEL text', sources: ['Brand guide.md'], rules: ['draft (strict)'] } }] },
    qualityReport: { version: 11, status: 'pass', checkedAt: now, articleSpecFingerprint: '', checks: Array.from({ length: 10 }, (_, i) => pass('c' + i)) } },
  { id: 'a-failed', title: 'Failed article', currentStep: 2, status: 'in_progress', createdAt: now, updatedAt: now,
    contentPlanId: 'plan-1', contentPlanItemId: 'i2', contentPlanInput: 'x', activityKind: 'batch', activityId: 'batch-1', batchStatus: 'failed', batchError: 'timeout' },
];
const plan = { id: 'plan-1', name: 'Plan One', status: 'active', version: 1, sourceFingerprint: '', totalArticles: 2, comparisonCount: 2, editorialCount: 0, reviewCount: 0, createdAt: now, updatedAt: now };
const structureFile = { id: 'outline-md', name: 'Outline forms.md', category: 'rules', fileType: 'md', size: '1 KB', uploadedAt: now, scanStatus: 'ready',
  content: '```outline-structures\n' + JSON.stringify({ version: 1, structures: [{ id: 'comparison', name: 'Comparison form', description: 'Compare two formats', useWhen: 'Two options', outlineInstructions: 'o', draftInstructions: 'd' }] }) + '\n```' };

async function mockApp(page: Page, role: 'admin' | 'user' = 'admin') {
  const user = { id: role, email: role + '@example.com', role };
  let serverFiles: any[] = [structureFile];
  const log = { files: [] as any[][], imports: [] as any[], reruns: [] as any[], puts: [] as any[], configs: [] as any[], created: [] as any[], started: [] as string[], imported: [] as any[], deleted: [] as string[] };
  await page.addInitScript(user => localStorage.setItem('writer:auth-session', JSON.stringify({ authProvider: 'postgres', accessToken: '', expiresAt: null, user })), user);
  const config = { ...DEFAULT_CONFIG, stepConfigs: { ...DEFAULT_CONFIG.stepConfigs, 3: { ...DEFAULT_CONFIG.stepConfigs[3], fileAccess: { kb: [], rules: ['outline-md'] } } } };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    const method = route.request().method();
    if (url.pathname === '/health') return route.fulfill({ json: { status: 'ok', databaseProvider: 'postgres', storageProvider: 'postgres', providers: { openai: true, anthropic: false }, seoResearch: false } });
    if (url.pathname === '/health/dependencies') return route.fulfill({ status: 503, json: { status: 'degraded', databaseConnected: true, authConnected: true, relationalContentPlans: true, threeStageSessions: false, supabaseUrl: 'SECRET_URL' } });
    if (url.pathname === '/api/auth/refresh') return route.fulfill({ json: { authProvider: 'postgres', accessToken: 'tok', expiresAt: null, user } });
    if (url.pathname === '/api/config' && method === 'POST') { log.configs.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname === '/api/config') return route.fulfill({ json: { ...config, railwayUrl: url.origin } });
    if (url.pathname === '/api/articles' && method === 'GET') return route.fulfill({ json: articles });
    if (url.pathname === '/api/articles' && method === 'POST') { const body = route.request().postDataJSON(); log.created.push(body); return route.fulfill({ json: { ok: true, article: body } }); }
    const rerun = url.pathname.match(/^\/api\/articles\/([^/]+)\/rerun$/);
    if (rerun) { const body = route.request().postDataJSON(); log.reruns.push({ id: rerun[1], ...body }); return route.fulfill({ status: 202, json: { ok: true, article: { ...articles[0], qualityReport: null, batchStatus: 'queued' } } }); }
    if (method === 'DELETE' && /^\/api\/(articles|batches)\//.test(url.pathname)) { log.deleted.push(decodeURIComponent(url.pathname)); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname.startsWith('/api/articles/') && method === 'PUT') { const patch = route.request().postDataJSON(); log.puts.push(patch); return route.fulfill({ json: { ok: true, article: { ...articles[0], ...patch } } }); }
    if (url.pathname === '/api/content-plans/import') { const ct = route.request().headers()['content-type'] ?? ''; log.imported.push(ct.includes('multipart') ? { multipart: route.request().postDataBuffer()?.toString() } : route.request().postDataJSON()); return route.fulfill({ json: { plan: { ...plan, id: 'plan-new', name: 'New plan', totalArticles: 3 } } }); }
    if (url.pathname === '/api/content-plans/plan-new/classify') return route.fulfill({ json: { plan: { ...plan, id: 'plan-new', name: 'New plan', totalArticles: 3, items: [
      { id: 'n1', title: 'A vs B', keywords: ['a vs b'], type: 'comparison-seo', sourceLine: 'A vs B' },
      { id: 'n2', title: 'C vs D', keywords: [], type: 'comparison-seo', sourceLine: 'C vs D' },
      { id: 'n3', title: 'Why E matters', keywords: [], type: 'needs-review', sourceLine: 'Why E matters' },
    ] } } });
    if (url.pathname === '/api/content-plans') return route.fulfill({ json: [plan] });
    const fileId = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (fileId && method === 'DELETE') { serverFiles = serverFiles.filter(f => f.id !== decodeURIComponent(fileId[1])); log.files.push(serverFiles.map(f => f.id)); const cfg = { ...config, stepConfigs: { ...config.stepConfigs, 3: { ...config.stepConfigs[3], fileAccess: { kb: [], rules: [] } } } }; log.configs.push(cfg); return route.fulfill({ json: { ok: true, files: serverFiles, config: cfg } }); }
    if (fileId && method === 'PATCH') { const body = route.request().postDataJSON(); serverFiles = serverFiles.map(f => f.id === decodeURIComponent(fileId[1]) ? { ...f, ...body } : f); return route.fulfill({ json: { ok: true, file: serverFiles.find(f => f.id === decodeURIComponent(fileId[1])) } }); }
    if (url.pathname === '/api/files') return route.fulfill({ json: serverFiles });
    if (url.pathname === '/api/import/source') { const body = route.request().postDataJSON(); log.imports.push(body); const record = { ...body, id: 'imported-1', content: body.content, scanStatus: 'ready' }; serverFiles = [record, ...serverFiles]; log.files.push(serverFiles.map(f => f.id)); return route.fulfill({ json: { target: 'writer:files', record } }); }
    const start = url.pathname.match(/^\/api\/batches\/([^/]+)\/start$/);
    if (start) { log.started.push(decodeURIComponent(start[1])); return route.fulfill({ json: { ok: true } }); }
    if (url.pathname.startsWith('/api/batches/') || url.pathname === '/api/batch-status') return route.fulfill({ json: { articles: [] } });
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

  // Changing a gate model must keep the Shipper's document access.
  await goHash(page, '/settings/workflow-ai');
  // Backend status comes from Railway's health checks, not a link.
  await expect(page.getByText('Suy giảm')).toBeVisible();
  await expect(page.getByText(/thiếu bảng, cần chạy migration/)).toBeVisible();
  await expect(page.getByText('1 đã cấu hình')).toBeVisible();
  await expect(page.getByText('SECRET_URL')).toHaveCount(0);
  await page.getByLabel(/Số từ tiếng Anh mục tiêu|Target English words/).fill('2000');
  // Save lives in the page header next to the breadcrumb, like every other CRM page action.
  await page.locator('.ph-actions').getByRole('button', { name: /Lưu thay đổi|Save changes/ }).click();
  await expect.poll(() => log.configs.length).toBe(2);
  expect(log.configs[1].stepConfigs[4].maxDraftWords).toBe(2000);
  expect(log.configs[1].stepConfigs[3].fileAccess).toEqual({ kb: [], rules: ['outline-md'] });

  await goHash(page, '/settings/models');
  await expect(page.getByText('ANTHROPIC_API_KEY')).toBeVisible();
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
  await panel.getByLabel(/Cấu trúc outline|Outline structure/).selectOption({ label: 'Comparison form' });
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
  await expect(page.getByLabel(/Cấu trúc outline|Outline structure/)).toHaveCount(0);
  const step3 = page.locator('details.plog').nth(2);
  await expect(step3.locator('summary').first()).toContainText('1 AI · 2.0k tok · $0.012');
  await step3.locator('summary').first().click();
  await step3.getByText(/^(Viết draft|Write the draft)/).click();
  await step3.getByText('MODEL_SENTINEL').click();
  await expect(step3.getByText('INPUT_SENTINEL prompt')).toBeVisible();
  await expect(step3.getByText('OUTPUT_SENTINEL text')).toBeVisible();
  await expect(step3.getByText('Brand guide.md')).toBeVisible();
  await expect(step3.getByText('draft (strict)')).toBeVisible();
  await page.getByRole('button', { name: /Chấm lại AI|Re-check AI/ }).click();
  await expect.poll(() => log.reruns.length).toBe(1);
  expect(log.reruns[0]).toEqual({ id: 'a-approved', gate: 4 });
});

test('CRM Storage adds, governs and deletes documents without the old settings page', async ({ page }) => {
  const log = await mockApp(page);
  await goHash(page, '/objects/storage');
  await page.locator('.ph-actions').getByRole('button', { name: /Thêm tài liệu|Add document/ }).click();
  const panel = page.getByRole('dialog', { name: /Thêm tài liệu|Add document/ });
  await panel.getByRole('tab', { name: 'Paste' }).click();
  await panel.getByLabel(/Tên nguồn|Source name/).fill('Brand facts');
  await panel.getByLabel(/^(Nội dung|Content)$/).fill('fact one\nfact two');
  await panel.getByRole('button', { name: /Nhập qua Railway|Import through Railway/ }).click();
  await expect.poll(() => log.files.length).toBe(1);
  expect(log.imports[0]).toMatchObject({ sourceType: 'paste', category: 'kb', name: 'Brand facts' });
  expect(log.files[0]).toEqual(['imported-1', 'outline-md']);
  await expect(page.getByText('Brand facts')).toBeVisible();

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByText('Outline forms.md').click();
  const doc = page.getByRole('dialog', { name: 'Document' });
  page.once('dialog', d => d.accept());
  await doc.getByRole('button', { name: /^(Xoá|Delete)$/ }).click();
  await expect.poll(() => log.files.length).toBe(2);
  expect(log.files[1]).toEqual(['imported-1']);
  expect(log.configs.at(-1).stepConfigs[3].fileAccess.rules).toEqual([]);
});

test('CRM Add Plan imports a Content Plan file and Storage lists it as Source data', async ({ page }) => {
  const log = await mockApp(page);
  await goHash(page, '/objects/storage');
  const row = page.locator('table.tbl tr', { hasText: 'Plan One' });
  await expect(row).toContainText('Source data');
  await row.click();
  await expect(page).toHaveURL(/#\/object\/plans\/plan-1/);

  await goHash(page, '/objects/plans');
  await page.locator('.ph-actions').getByRole('button', { name: 'Add Plan' }).click();
  const panel = page.getByRole('dialog', { name: 'Add Plan' });
  await panel.getByRole('tab', { name: 'File' }).click();
  await panel.getByLabel(/File Content Plan|Content Plan file/).setInputFiles({ name: 'Q3 plan.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('A vs B') });
  await expect(panel.getByText('Q3 plan.docx')).toBeVisible();
  await panel.getByLabel(/Cấu trúc outline|Outline structure/).selectOption({ label: 'Comparison form' });
  await panel.getByRole('button', { name: 'Generate' }).click();
  await expect(page).toHaveURL(/#\/object\/plans\/plan-new/);
  expect(log.imported[0].multipart).toContain('Q3 plan.docx');
  expect(log.imported[0].multipart).toContain('Q3 plan');
  expect(log.created).toHaveLength(3);
});

test('CRM plan page lists every topic and starts the unprocessed ones', async ({ page }) => {
  const items = [
    { id: 'i1', title: 'Approved topic', keywords: [], type: 'comparison-seo', sourceLine: 'x' },
    { id: 'i2', title: 'Failed topic', keywords: [], type: 'comparison-seo', sourceLine: 'x' },
    { id: 'i3', title: 'EDITORIAL_SENTINEL topic', keywords: ['brand story'], type: 'editorial-originality', sourceLine: 'x' },
  ];
  (plan as any).items = items;
  try {
    const log = await mockApp(page);
    await goHash(page, '/object/plans/plan-1');
    await page.getByRole('tab', { name: /Articles/ }).click();
    const row = page.locator('.list-row', { hasText: 'EDITORIAL_SENTINEL topic' });
    await expect(row).toContainText(/Chưa chạy|Not started/);
    await expect(row).toContainText('Editorial');
    await expect(page.locator('.list-row', { hasText: 'Approved article' })).toBeVisible();
    await page.getByRole('button', { name: /Chạy topic chưa xử lý|Run unprocessed topics/ }).click();
    const panel = page.getByRole('dialog', { name: /Chạy topic chưa xử lý|Run unprocessed topics/ });
    await panel.getByLabel(/Cấu trúc outline|Outline structure/).selectOption({ label: 'Comparison form' });
    await panel.getByRole('button', { name: 'Generate' }).click();
    await expect.poll(() => log.created.length).toBe(1);
    expect(log.created[0]).toMatchObject({ activityType: 'editorial-originality', contentPlanItemId: 'i3', activityKind: 'batch' });
  } finally { delete (plan as any).items; }
});

test('CRM Editorial article waits for outline approval, then drafts through the pipeline', async ({ page }) => {
  const editorial = { id: 'a-editorial', title: 'Editorial piece', topic: 'Editorial piece', currentStep: 3, status: 'review', createdAt: now, updatedAt: now,
    contentPlanId: 'plan-1', contentPlanItemId: 'i9', contentPlanInput: 'x', activityKind: 'batch', activityId: 'batch-ed', activityType: 'editorial-originality', batchStatus: 'awaiting_approval',
    selectedCoreIdeaId: 'e', coreIdeaSuggestions: [{ id: 'e', title: 'Idea E', angleLabel: 'Essay', rating: { overall: 9 } }],
    outlineStructure: { id: 'comparison', name: 'Comparison form', sourceId: 'outline-md', sourceHash: 'h' }, outline: [{ id: 's1', heading: 'EDITORIAL_OUTLINE heading', notes: '', level: 'h2' }], editorialApproval: { status: 'pending' } };
  articles.push(editorial as any);
  try {
    const log = await mockApp(page);
    const g2 = page.getByRole('region', { name: 'G2 Outline' });
    await expect(g2.getByText('Editorial piece')).toBeVisible();
    await g2.getByRole('button', { name: 'Duyệt outline' }).click();
    await expect(page).toHaveURL(/a-editorial\?tab=manual/);
    await page.getByRole('button', { name: /Duyệt outline & viết draft|Approve outline & write draft/ }).click();
    await expect.poll(() => log.reruns.length).toBe(1);
    expect(log.puts.at(-1).editorialApproval).toMatchObject({ status: 'approved' });
    expect(log.reruns[0]).toEqual({ id: 'a-editorial', gate: 3 });
  } finally { articles.pop(); }
});

test('CRM keeps unsaved edits: leaving asks first, and a conflicting settings save is rolled back', async ({ page }) => {
  await mockApp(page);
  await goHash(page, '/object/articles/a-approved?tab=manual');
  await page.getByLabel(/^(Bản nháp|Draft)$/).fill('UNSAVED_SENTINEL');
  let asked = 0;
  page.on('dialog', d => { asked++; void d.dismiss(); });
  await page.getByRole('tab', { name: /AI Review/ }).click();
  expect(asked).toBe(1);
  await expect(page.getByLabel(/^(Bản nháp|Draft)$/)).toHaveValue('UNSAVED_SENTINEL');
  await goHash(page, '/objects/plans');
  await expect.poll(() => asked).toBe(2);
  await expect(page).toHaveURL(/a-approved\?tab=manual/);

  page.removeAllListeners('dialog');
  page.on('dialog', d => void d.accept());
  await page.unroute('**/api/config');
  await page.route('**/api/config', route => route.request().method() === 'POST' ? route.fulfill({ status: 409, json: { code: 'CONFIG_CONFLICT', error: 'CONFLICT_SENTINEL' } }) : route.fallback());
  await goHash(page, '/settings/pipeline');
  const threshold = page.getByLabel('Threshold (%)');
  await threshold.fill('77');
  await threshold.press('Enter');
  await expect(page.getByRole('alert')).toContainText('CONFLICT_SENTINEL');
});

test('CRM tables: the sticky first column never covers the next column', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('button', { name: 'Table' }).waitFor();
  await page.evaluate(() => { location.hash = '#/objects/reviews' });
  const row = page.locator('table.tbl tbody tr[tabindex]').first();
  const [first, second] = [await row.locator('td').nth(0).boundingBox(), await row.locator('td').nth(1).boundingBox()];
  expect(first!.x + first!.width).toBeLessThanOrEqual(second!.x + 1);
  await expect(row.locator('td').nth(1)).toHaveText('Chưa review');
});

test('CRM bulk delete: admins select several articles or batches and delete them in one go', async ({ page }) => {
  const log = await mockApp(page);
  await page.getByRole('button', { name: 'Table' }).click();
  await page.getByRole('checkbox', { name: /Chọn tất cả|Select all/ }).check();
  const bar = page.getByRole('region', { name: /Thao tác hàng loạt|Bulk actions/ });
  await expect(bar).toContainText('2');
  page.once('dialog', d => { expect(d.message()).toContain('2'); void d.accept(); });
  await bar.getByRole('button', { name: /Xoá 2 bài|Delete 2 articles/ }).click();
  await expect.poll(() => log.deleted.sort()).toEqual(['/api/articles/a-approved', '/api/articles/a-failed']);
  await expect(page.getByText('Approved article')).toHaveCount(0);

  await goHash(page, '/objects/batches');
  await expect(page.getByText(/Không có dữ liệu|Nothing here/)).toBeVisible();
});

test('CRM bulk delete removes whole batches through the batch endpoint', async ({ page }) => {
  const log = await mockApp(page);
  await goHash(page, '/objects/batches');
  await page.getByRole('checkbox', { name: /Chọn Batch|Select Batch/ }).first().check();
  page.once('dialog', d => void d.accept());
  await page.getByRole('region', { name: /Thao tác hàng loạt|Bulk actions/ }).getByRole('button', { name: /Xoá 1 batch|Delete 1 batch/ }).click();
  await expect.poll(() => log.deleted).toEqual(['/api/batches/batch-1']);
  await expect(page.getByText(/Không có dữ liệu|Nothing here/)).toBeVisible();
});

test('CRM bulk delete is admin-only', async ({ page }) => {
  await mockApp(page, 'user');
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.locator('table.tbl')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('CRM Workflow AI lists every AI task and saves models, numbers and team instructions', async ({ page }) => {
  const log = await mockApp(page);
  await goHash(page, '/settings/models');
  await page.getByRole('switch', { name: 'GPT-6.2 Sol' }).click();
  await page.locator('.ph-actions').getByRole('button', { name: /Lưu thay đổi|Save changes/ }).click();
  await expect.poll(() => log.configs.length).toBe(1);

  await goHash(page, '/settings/workflow-ai');
  for (const task of ['Phân loại Content Plan', 'Ý tưởng & Article Spec', 'SEO keyword research', 'Outline', 'Viết draft', 'AI Review', 'Tóm tắt Website Inventory'])
    await expect(page.getByLabel(`${task} model`)).toBeVisible();
  await expect(page.getByText(/Chưa chọn model/)).toBeVisible();
  await expect(page.getByText('Pipeline behavior')).toHaveCount(0);
  await expect(page.locator('.ph-actions').getByRole('button', { name: /Lưu thay đổi|Save changes/ })).toBeDisabled();

  await page.getByLabel('AI Review model').selectOption({ label: 'GPT-6.2 Sol' });
  await page.getByLabel('SEO keyword research model').selectOption({ label: 'GPT-6.2 Sol' });
  await page.getByLabel('Phân loại Content Plan model').selectOption({ label: 'GPT-6.2 Sol' });
  await page.getByLabel('Số keyword nghiên cứu').fill('12');
  await page.getByLabel(/Hướng dẫn cho G2/).fill('Use short H2 headings.');
  await page.locator('.ph-actions').getByRole('button', { name: /Lưu thay đổi|Save changes/ }).click();
  await expect.poll(() => log.configs.length).toBe(2);
  const saved = log.configs[1];
  expect(saved.taskModels).toMatchObject({ review: 'gpt-6.2-sol', seo: 'gpt-6.2-sol' });
  expect(saved.stepConfigs[1].modelId).toBe('gpt-6.2-sol');
  expect(saved.workflowRules['core-idea'].stageOverrides['market-research'].parameters.keywordCount).toBe(12);
  expect(saved.workflowRules.outline.customInstruction).toBe('Use short H2 headings.');
});

test('CRM tables keep long titles readable next to the checkbox column', async ({ page }) => {
  const long = 'How to Choose Between Whiteboard Animation and Motion Graphics for Corporate Training Programs';
  (articles as any).push({ ...articles[0], id: 'a-long', title: long, activityId: 'batch-1' });
  try {
    await mockApp(page);
    await page.getByRole('button', { name: 'Table' }).click();
    const row = page.locator('table.tbl tbody tr', { hasText: long });
    // The checkbox has its own sticky column (demo: td.cb); the title chip starts in the Title cell and is painted.
    const [cb, title, chip] = [await row.locator('td.cb').boundingBox(), await row.locator('td.first').boundingBox(), await row.locator('td.first .rchip').boundingBox()];
    expect(cb!.x + cb!.width).toBeLessThanOrEqual(title!.x + 1);
    expect(chip!.x).toBeGreaterThanOrEqual(title!.x);
    expect(chip!.width).toBeGreaterThan(120);
  } finally { (articles as any).pop(); }
});
