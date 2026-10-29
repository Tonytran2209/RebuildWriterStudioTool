import {test, expect, setTheme} from './browser-fixture';
import type {Locator} from '@playwright/test';

// Synthetic local article exercises real controls; it is not a production reproduction.
async function expectReadable(locator: Locator) {
  const ratio = await locator.evaluate(element => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const blend = (front: number[], back: number[]) => {
      const alpha = front[3] ?? 1;
      return [0, 1, 2].map(i => front[i] * alpha + back[i] * (1 - alpha));
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) background = blend(rgb(getComputedStyle(node).backgroundColor), background);
    const foreground = blend(rgb(getComputedStyle(element).color), background);
    const luminance = (color: number[]) => color.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light', 'dark'] as const) {
  test(`image placement controls retain contrast and behavior in ${theme}`, async ({page}) => {
    await page.goto(`/?qc=recheck&theme=${theme}`);
    // Include the app's final stylesheet and root theme, absent from the legacy fixture.
    await page.addStyleTag({url: '/src/ui-guide.css'});
    await page.evaluate(theme => document.documentElement.dataset.writerTheme = theme, theme);
    const panel = page.locator('.image-placement-suggestions');
    const source = page.getByTestId('stored-source');
    const original = await source.textContent();
    await expectReadable(panel.getByRole('button', {name: 'Suggest images', exact: true}));
    await panel.getByRole('button', {name: 'Suggest images', exact: true}).click();
    await expect(panel.locator('.image-placement-status-suggested').first()).toBeVisible();
    for (const element of await panel.locator('button, .image-placement-badge').all()) {
      await expectReadable(element);
      if (await element.evaluate(e => e.tagName === 'BUTTON')) {
        await element.hover();
        await expectReadable(element);
        await element.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(element).toBeFocused();
        expect(await element.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid');
        expect(await element.evaluate(e => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
      }
    }
    const card = panel.locator('.image-placement-status-suggested').first().locator('..').locator('..');
    page.once('dialog', dialog => dialog.accept('Updated local image brief'));
    await card.getByRole('button', {name: 'Edit', exact: true}).click();
    await card.getByText('View image brief', {exact: true}).click();
    await expect(card).toContainText('Updated local image brief');
    await expect(source).toHaveText(original!);
    await card.getByRole('button', {name: 'Approve', exact: true}).click();
    await expectReadable(panel.locator('.image-placement-status-approved'));
    await expect(source).toContainText('image-placeholder://');
    const approvedSource = await source.textContent();
    await panel.getByRole('button', {name: 'Dismiss', exact: true}).first().click();
    await expectReadable(panel.locator('.image-placement-status-dismissed'));
    await expect(source).toHaveText(approvedSource!);
    await setTheme(page, theme === 'light' ? 'dark' : 'light');
    await page.evaluate(theme => document.documentElement.dataset.writerTheme = theme === 'light' ? 'dark' : 'light', theme);
    await expect(panel.locator('.image-placement-status-approved')).toBeVisible();
    await expect(source).toHaveText(approvedSource!);
    await panel.getByRole('button', {name: 'Refresh', exact: true}).click();
    await expect(panel.locator('.image-placement-status-approved')).toHaveCount(0);
    await expect(panel.locator('.image-placement-status-suggested').first()).toBeVisible();
    await expect(source).toHaveText(approvedSource!);
  });
}
