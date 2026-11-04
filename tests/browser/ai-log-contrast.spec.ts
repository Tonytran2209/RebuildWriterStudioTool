import {test, expect} from './browser-fixture';
import type {Locator} from '@playwright/test';

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

// Synthetic fixture establishes the portal contract, not a production reproduction.
for (const theme of ['light', 'dark'] as const) {
  test(`AI log portal contrast and unchanged content in ${theme}`, async ({page}) => {
    await page.addInitScript(() => {
      const events = Array.from({length: 24}, (_, i) => ({
        id: `event-${i}`, stage: 'validation', status: ['completed', 'warning', 'error', 'running'][i % 4],
        title: `Audit event ${i}`, detail: 'Long supporting evidence detail. '.repeat(12),
        facts: {model: 'fixture', result: 'unchanged'}, sources: ['https://example.com/evidence'],
      }));
      sessionStorage.setItem('qc-fixture', JSON.stringify({id: 'log-fixture', topic: 'Fixture', draft: '# Unchanged draft', keywords: 'fixture', outline: [], currentStep: 4, status: 'draft', step4ProcessTrace: events, step4RawResponseExcerpt: '{"fixture":"unchanged"}'}));
    });
    await page.goto(`/?qc=warning&theme=${theme}`);
    await page.addStyleTag({url: '/src/settings-interactions.css'});
    await page.addStyleTag({url: '/src/ui-guide.css'});
    await page.evaluate(theme => {
      document.body.classList.remove('codex-dark', 'writer-light');
      document.documentElement.dataset.writerTheme = theme;
    }, theme);
    const saved = await page.evaluate(() => sessionStorage.getItem('qc-fixture'));
    const open = async () => {
      await page.locator('.ai-log-button').click();
      await expect(page.getByRole('dialog', {name: 'Draft generation log'})).toBeVisible();
    };
    await open();
    const modal = page.locator('.ai-log-modal');
    const text = await modal.textContent();
    const verify = async () => {
      for (const element of await modal.locator('h3, h4, p, pre, .ai-log-fact, .ai-log-fact b, .ai-log-source, .ai-log-step, .ai-log-close, .uppercase').all()) await expectReadable(element);
      for (const control of await modal.locator('.ai-log-close, .ai-log-source').all()) {
        await control.hover();
        await expectReadable(control);
        await control.focus();
        expect(await control.evaluate(e => getComputedStyle(e).outlineStyle)).toBe('solid');
        expect(await control.evaluate(e => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThanOrEqual(2);
      }
      const content = modal.locator('.ai-log-content');
      expect(await content.evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
      await content.evaluate(e => e.scrollTop = e.scrollHeight);
      expect(await content.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
      expect(await modal.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    };
    await verify();
    await page.evaluate(theme => document.documentElement.dataset.writerTheme = theme === 'light' ? 'dark' : 'light', theme);
    await verify();
    await expect(modal).toHaveText(text!);
    // Exercise the actual preference hook resolving System to Dark, without body theme classes.
    await page.emulateMedia({colorScheme: 'dark'});
    await page.evaluate(async () => {
      localStorage.setItem('writer:theme-preference', 'system');
      const reactPath = '/node_modules/.vite/deps/react.js';
      const domPath = '/node_modules/.vite/deps/react-dom_client.js';
      const themePath = '/src/lib/theme.ts';
      const React = await import(reactPath);
      const {createRoot} = await import(domPath);
      const {useThemePreference} = await import(themePath);
      const host = document.createElement('div'); document.body.append(host);
      function ThemeProbe() { useThemePreference(); return null; }
      createRoot(host).render(React.createElement(ThemeProbe));
    });
    await expect(page.locator('html')).toHaveAttribute('data-writer-theme', 'dark');
    await verify();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await open();
    await modal.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(modal).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('qc-fixture'))).toBe(saved);
  });
}
