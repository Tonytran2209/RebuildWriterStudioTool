import { test, expect } from './browser-fixture';

// Synthetic API records verify the viewing contract, not production reproduction.
const versions = ['outline', 'draft'].flatMap(stage => [1, 2].map(revision => ({
  id: `${stage}-${revision}`, stage, revision_number: revision,
  created_at: '2026-11-05T08:00:00Z',
  output_snapshot: { generationId: `${stage}-generation-${revision}`,
    ...(stage === 'draft' ? { markdown: '# Identical saved draft' } : { sections: [{ id: 'saved', heading: 'Identical saved outline', notes: 'Immutable notes' }] }) },
})));

test('distinct identical versions, keyboard selection, reload and article isolation never mutate current state', async ({ page }) => {
  const mutations: string[] = [];
  await page.route('**/api/**', route => {
    const request = route.request();
    if (request.url().endsWith('/stages')) return route.fulfill({ json: { stages: request.url().includes('reopen-0') ? versions : [] } });
    if (request.method() !== 'GET') mutations.push(request.url());
    return route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/?reopen&versions');
  const before = await page.getByTestId('reopen-state').textContent();
  for (const stage of ['outline', 'draft']) {
    await page.getByRole('button', { name: stage === 'outline' ? /Lịch sử outline|Outline history/ : /Lịch sử draft|Draft history/ }).click();
    const select = page.getByRole('combobox', { name: stage === 'outline' ? /Phiên bản outline|Outline version/ : /Phiên bản draft|Draft version/ });
    await expect(select.locator('option')).toHaveCount(3);
    await select.focus();
    await select.press('ArrowDown');
    await select.press('Enter');
    await select.selectOption(`${stage}-1`);
    await expect(page.getByTestId(`${stage}-history-preview`)).toContainText(stage === 'outline' ? 'Identical saved outline' : 'Identical saved draft');
  }
  await page.reload();
  await expect(page.getByTestId('draft-history-preview')).toContainText('Identical saved draft');
  await page.getByRole('button', { name: 'Open 1', exact: true }).click();
  await expect(page.getByTestId('draft-history-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open 0', exact: true }).click();
  expect(await page.getByTestId('reopen-state').textContent()).toBe(before);
  expect(mutations).toEqual([]);
});

test('history failure, retry, empty and legacy metadata retain live content', async ({ page }) => {
  let mode = 'error';
  await page.route('**/api/**', route => route.request().url().endsWith('/stages')
    ? route.fulfill(mode === 'error' ? { status: 500, json: { error: 'Offline fixture error' } } : { json: { stages: mode === 'empty' ? [] : [{ id: 'legacy', stage: 'draft', revision_number: 1, output_snapshot: { markdown: 'Legacy saved draft' } }] } })
    : route.fulfill({ status: 401, json: {} }));
  await page.goto('/?reopen&versions');
  await page.getByRole('button', { name: /Lịch sử draft|Draft history/ }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Không tải được lịch sử|Could not load history/ })).toBeVisible();
  mode = 'empty';
  await page.getByRole('button', { name: /Tải lại lịch sử|Reload history/ }).click();
  await expect(page.getByText(/Chưa có phiên bản đã lưu|No saved versions yet/)).toBeVisible();
  mode = 'legacy';
  await page.getByRole('button', { name: /Tải lại lịch sử|Reload history/ }).click();
  await page.getByRole('combobox', { name: /Phiên bản draft|Draft version/ }).selectOption('legacy');
  await expect(page.getByTestId('draft-history-preview')).toContainText('Legacy saved draft');
  expect(JSON.parse((await page.getByTestId('reopen-state').textContent())!).updates).toEqual([]);
});


test('history keeps pending editor changes and navigation autosaves only to its owning article', async ({ page }) => {
  await page.route('**/api/**', route => route.request().url().endsWith('/stages')
    ? route.fulfill({ json: { stages: versions } })
    : route.fulfill({ status: 401, json: {} }));
  await page.goto('/?reopen&versions');
  await page.getByRole('button', { name: /Chỉnh sửa toàn bộ bản nháp|Edit full draft/ }).click();
  const editor = page.locator('[contenteditable="true"]');
  await editor.fill('Pending current article edit');
  await page.getByRole('button', { name: /Lịch sử draft|Draft history/ }).click();
  await page.getByRole('combobox', { name: /Phiên bản draft|Draft version/ }).selectOption('draft-1');
  await expect(editor).toHaveText('Pending current article edit');
  await page.getByRole('button', { name: 'Open 1', exact: true }).click();
  await expect.poll(async () => {
    const state = JSON.parse((await page.getByTestId('reopen-state').textContent())!);
    return state.articles[0].draft;
  }).toBe('Pending current article edit');
  const state = JSON.parse((await page.getByTestId('reopen-state').textContent())!);
  expect(state.articles[1].draft).toBe('Saved draft 1');
  expect(state.updates.every((update: any) => update.articleId === 'reopen-0')).toBe(true);
});
