import { test, expect, setTheme } from './browser-fixture';

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

for (const theme of ['light', 'dark', 'system']) {
  test(`draft toolbar history disclosure preserves editor identity in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(preference => localStorage.setItem('writer:theme-preference', preference), theme);
    await page.route('**/api/**', route => route.request().url().endsWith('/stages')
      ? route.fulfill({ json: { stages: versions } })
      : route.fulfill({ status: 401, json: {} }));
    await page.goto('/?reopen&versions');
    // The reopen fixture exposes raw JSON diagnostics outside the product UI.
    // Keep those diagnostics readable without letting their preformatted line widen the page.
    await page.getByTestId('reopen-state').evaluate(node => {
      node.style.whiteSpace = 'pre-wrap';
      node.style.overflowWrap = 'anywhere';
    });
    // Bootstrap selects appearance via URL rather than mounting the App theme hook.
    const resolvedTheme = theme === 'system' ? 'dark' : theme as 'light' | 'dark';
    await setTheme(page, resolvedTheme);
    await expect(page.locator('body')).toHaveClass(new RegExp(resolvedTheme === 'dark' ? 'codex-dark' : 'writer-light'));
    const history = page.getByRole('button', { name: /Lịch sử draft|Draft history/ });
    const toolbar = page.locator('.draft-toolbar');
    const generate = toolbar.getByRole('button', { name: /Tạo lại Draft|Regenerate draft/ });
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('combobox', { name: /Phiên bản draft|Draft version/ })).toHaveCount(0);
    expect(await history.locator('svg').count()).toBe(1);
    expect(await history.textContent()).toBe('');
    expect(await toolbar.locator('button').evaluateAll(buttons => buttons[1].getAttribute('aria-label'))).toMatch(/Lịch sử draft|Draft history/);
    const historyBox = (await history.boundingBox())!;
    const generateBox = (await generate.boundingBox())!;
    const minimumTarget = page.viewportSize()!.width <= 600 ? 44 : 32;
    expect(historyBox.width).toBeGreaterThanOrEqual(minimumTarget);
    expect(historyBox.height).toBeGreaterThanOrEqual(minimumTarget);
    expect(generateBox.x + generateBox.width).toBeLessThanOrEqual(historyBox.x);
    const styleOf = (node: HTMLElement | SVGElement) => {
      const style = getComputedStyle(node);
      return [style.width, style.height, style.border, style.borderRadius, style.color, style.backgroundColor];
    };
    const aiLog = toolbar.getByRole('button', { name: /Xem nhật ký AI|View AI log/ });
    expect(await history.evaluate(styleOf)).toEqual(await aiLog.evaluate(styleOf));
    expect(Math.max(historyBox.y, generateBox.y)).toBeLessThan(Math.min(historyBox.y + historyBox.height, generateBox.y + generateBox.height));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: /Chỉnh sửa toàn bộ bản nháp|Edit full draft/ }).click();
    const editor = page.locator('[contenteditable="true"]');
    const originalEditor = await editor.elementHandle();
    await editor.fill('Pending toolbar history edit');
    await history.focus();
    await expect(history.locator('..').getByRole('tooltip')).toBeVisible();
    await history.press('Enter');
    await expect(history).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('combobox', { name: /Phiên bản draft|Draft version/ }).selectOption('draft-1');
    await expect(page.getByTestId('draft-history-preview')).toBeVisible();
    const panel = page.locator('.draft-editor > .draft-history-panel > section');
    await expect(panel).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    const toolbarBox = (await toolbar.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual((await editor.boundingBox())!.y);
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(editor).toHaveText('Pending toolbar history edit');
    expect(await editor.evaluate((node, original) => node === original, originalEditor)).toBe(true);
    await history.press('Space');
    await expect(history).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('draft-history-preview')).toHaveCount(0);
    await expect(editor).toHaveText('Pending toolbar history edit');
    expect(await editor.evaluate((node, original) => node === original, originalEditor)).toBe(true);
  });
}

for (const theme of ['light', 'dark', 'system']) {
  test(`outline history whole card and sibling controls in ${theme}`, async ({ page }) => {
    let loads = 0;
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.route('**/api/**', route => {
      if (route.request().url().endsWith('/stages')) {
        loads++;
        return route.fulfill({ json: { stages: versions } });
      }
      return route.fulfill({ status: 401, json: {} });
    });
    await page.goto('/?reopen&versions');
    await setTheme(page, theme === 'light' ? 'light' : 'dark');
    const before = await page.getByTestId('reopen-state').textContent();
    const trigger = page.getByRole('button', { name: /Lịch sử outline|Outline history/ });
    const card = trigger.locator('xpath=ancestor::section[1]');
    const select = card.getByRole('combobox', { name: /Phiên bản outline|Outline version/ });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(loads).toBe(0);
    await expect(trigger.locator('svg')).toHaveCount(2);
    const box = (await trigger.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.width - cardBox.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.height - cardBox.height)).toBeLessThanOrEqual(2);
    // Click padding at the far right, away from the text and chevron.
    await trigger.click({ position: { x: box.width - 4, y: box.height / 2 } });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(select.locator('option')).toHaveCount(3);
    await select.selectOption('outline-1');
    await card.getByText(/Chi tiết snapshot|Snapshot details/, { exact: true }).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await card.getByRole('button', { name: /Tải lại lịch sử|Reload history/ }).click();
    await expect(select).toBeEnabled();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await trigger.focus();
    await trigger.press('Space');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toBeFocused();
    await expect(select).toBeVisible();
    await trigger.click();
    await trigger.locator('svg').first().click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await page.getByTestId('reopen-state').textContent()).toBe(before);
  });
}
