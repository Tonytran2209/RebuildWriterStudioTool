import { test, expect } from '@playwright/test';

test('Rules importer retains successful documents after a partial upload failure', async ({ page }) => {
  let uploads = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/api/auth/refresh') return route.fulfill({ status: 401, json: {} });
    if (url.pathname === '/api/documents/storage') return route.fulfill({ json: { provider: 'filesystem', database: 'postgres', configured: true } });
    if (url.pathname === '/api/upload/document') {
      uploads++;
      expect(route.request().postDataBuffer()?.toString()).toContain('rules');
      if (uploads === 2) return route.fulfill({ status: 422, json: { error: 'No readable text' } });
      return route.fulfill({ json: { target: 'writer:files', record: { id: `file-${uploads}`, name: `guide-${uploads}.md`, category: 'rules', content: 'Writing guide', fileType: 'md' } } });
    }
    return route.continue();
  });
  await page.goto('/?library');
  await expect(page.getByText(/File gốc: Volume Railway/)).toBeVisible();
  await page.getByRole('button', { name: 'Skills & Rules', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles([
    { name: 'good.md', mimeType: 'text/markdown', buffer: Buffer.from('Guide one') },
    { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') },
    { name: 'another.md', mimeType: 'text/markdown', buffer: Buffer.from('Guide two') },
  ]);
  await expect(page.getByRole('status')).toContainText('2/3');
  await expect(page.getByRole('alert')).toContainText('empty.txt: No readable text');
  await expect(page.getByTestId('library-records')).toContainText('file-3');
  const records = JSON.parse(await page.getByTestId('library-records').innerText());
  expect(records).toHaveLength(2);
  expect(records.every((record: any) => record.category === 'rules')).toBe(true);
});
