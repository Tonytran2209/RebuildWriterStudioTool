import {test, expect} from './browser-fixture';
import type {Locator} from '@playwright/test';

async function readable(locator: Locator) {
  const ratio = await locator.evaluate(element => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const ancestors: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) {
      const color = rgb(getComputedStyle(node).backgroundColor), alpha = color[3] ?? 1;
      background = background.map((value, i) => color[i] * alpha + value * (1 - alpha));
    }
    const luminance = (color: number[]) => color.slice(0, 3).map(value => {
      const c = value / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const values = [luminance(rgb(getComputedStyle(element).color)), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const preference of ['dark', 'light', 'system'] as const) {
  test(`portal AI log follows ${preference} appearance and preserves saved data`, async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('writer:language', 'en'));
    await page.emulateMedia({colorScheme: 'dark'});
    await page.goto('/?qc=pass');
    await expect(page.getByTestId('stored-source')).toBeAttached();
    // Synthetic local trace exercises the actual modal; this is not production data.
    await page.evaluate(() => {
      const article = JSON.parse(sessionStorage.getItem('qc-fixture')!);
      article.step4ProcessTrace = Array.from({length: 24}, (_, i) => ({
        id: `local-${i}`, title: `Local event ${i + 1}`, stage: 'validation',
        status: ['completed', 'warning', 'error'][i % 3], detail: 'Local evidence review detail.',
        facts: {model: 'fixture', passed: 18}, sources: ['https://example.com/evidence'],
      }));
      article.step4RawResponseExcerpt = '{"local":"saved response"}';
      sessionStorage.setItem('qc-fixture', JSON.stringify(article));
    });
    await page.reload();
    await page.addStyleTag({url: '/src/ui-guide.css'});
    const original = await page.evaluate(() => sessionStorage.getItem('qc-fixture'));
    // Keep the legacy dark class on the app only, never on the portal's ancestors.
    await page.evaluate(async preference => {
      document.body.classList.remove('codex-dark', 'writer-light');
      document.querySelector('main')!.classList.add('codex-dark');
      // Use the real theme hook so System resolution and live preference updates are covered.
      // Dynamic browser imports do not receive Vite's static CJS named-import rewrite.
      const {default: React} = await import('/node_modules/.vite/deps/react.js');
      const {default: ReactDOMClient} = await import('/node_modules/.vite/deps/react-dom_client.js');
      const {useThemePreference} = await import('/src/lib/theme.ts');
      localStorage.setItem('writer:theme-preference', preference);
      function ThemeFixture() {
        const {setPreference} = useThemePreference();
        Object.assign(window, {setLogTheme: setPreference});
        return null;
      }
      const host = document.createElement('div'); document.body.append(host);
      ReactDOMClient.createRoot(host).render(React.createElement(ThemeFixture));
    }, preference);
    const initial = preference === 'light' ? 'light' : 'dark';
    await expect(page.locator('html')).toHaveAttribute('data-writer-theme', initial);
    await page.getByRole('button', {name: 'View AI log', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: 'Draft generation log'});
    await expect(dialog).toBeVisible();
    const contents = await dialog.textContent();
    for (const theme of [initial, initial === 'dark' ? 'light' : 'dark'] as const) {
      await page.evaluate(theme => (window as any).setLogTheme(theme), theme);
      await expect(page.locator('html')).toHaveAttribute('data-writer-theme', theme);
      const background = theme === 'dark' ? 'rgb(23, 23, 23)' : 'rgb(255, 255, 255)';
      await expect(dialog.locator('.ai-log-event').first()).toHaveCSS('background-color', background);
      for (const selector of ['h3', 'h4', '.ai-log-event p', '.ai-log-fact', '.ai-log-fact b', '.ai-log-source', '.ai-log-step.is-completed', '.ai-log-step.is-warning', '.ai-log-step.is-error', '.ai-log-close', 'pre']) {
        await readable(dialog.locator(selector).first());
      }
      await dialog.locator('.ai-log-close').hover();
      await readable(dialog.locator('.ai-log-close'));
      await dialog.locator('.ai-log-source').first().hover();
      await readable(dialog.locator('.ai-log-source').first());
      await expect(dialog.locator('.ai-log-source').first()).toHaveAttribute('href', 'https://example.com/evidence');
      expect(await dialog.textContent()).toBe(contents);
    }
    await dialog.locator('pre').scrollIntoViewIfNeeded();
    await expect(dialog.locator('pre')).toBeVisible();
    expect(await dialog.locator('.ai-log-content').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
    expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', {name: 'View AI log', exact: true}).click();
    await dialog.getByRole('button', {name: 'Close', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('qc-fixture'))).toBe(original);
  });
}
