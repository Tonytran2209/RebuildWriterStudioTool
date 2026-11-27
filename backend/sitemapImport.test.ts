import assert from 'node:assert/strict'
import test from 'node:test'
import { parseLlmsTxt, parseSitemap, robotsSitemaps } from './websiteInventory.ts'
import { storedLabRuns, labJobRecords } from './jobHistory.ts'
import { SITEMAP_IMPORT_JOB } from './batchSteps.ts'

test('sitemap: page URLs from a urlset, child sitemaps from an index, CDATA and entities decoded', () => {
  const urlset = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/</loc><lastmod>2026-01-01</lastmod></url>
    <url><loc><![CDATA[https://example.com/a?x=1&amp;y=2]]></loc></url>
    <url>
      <loc> https://example.com/b </loc>
    </url></urlset>`
  assert.deepEqual(parseSitemap(urlset), { urls: ['https://example.com/', 'https://example.com/a?x=1&y=2', 'https://example.com/b'], sitemaps: [] })
  const index = '<sitemapindex><sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap><sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap></sitemapindex>'
  assert.deepEqual(parseSitemap(index), { urls: [], sitemaps: ['https://example.com/post-sitemap.xml', 'https://example.com/page-sitemap.xml'] })
  assert.deepEqual(parseSitemap('<html>not a sitemap</html>'), { urls: [], sitemaps: [] })
})

test('robots.txt Sitemap lines and llms.txt links are resolved against the site', () => {
  assert.deepEqual(robotsSitemaps('User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap_index.xml\nsitemap: /extra.xml', 'https://example.com'), ['https://example.com/sitemap_index.xml', 'https://example.com/extra.xml'])
  const llms = '# Example\n> Studio\n\n## Services\n- [Medical animation](https://example.com/medical): 2D patient education videos.\n- [About](/about)\nSome prose with [a link](https://example.com/x).\n* [Pricing](https://example.com/pricing): How we price.'
  assert.deepEqual(parseLlmsTxt(llms, 'https://example.com'), [
    { url: 'https://example.com/medical', title: 'Medical animation', description: '2D patient education videos.' },
    { url: 'https://example.com/about', title: 'About', description: '' },
    { url: 'https://example.com/pricing', title: 'Pricing', description: 'How we price.' },
  ])
})

test('sitemap import runs are reported as their own job: success, failure with code, running, missing start', () => {
  const runs = storedLabRuns([
    { runId: 's1', job: SITEMAP_IMPORT_JOB, workload: 'Website Inventory · example.com', status: 'success', startedAt: '2026-11-27T00:00:00Z', endedAt: '2026-11-27T00:00:04Z', items: { total: 3, succeeded: 2 } },
    { runId: 's2', job: SITEMAP_IMPORT_JOB, workload: 'Website Inventory · example.com', status: 'failed', startedAt: '2026-11-27T01:00:00Z', endedAt: '2026-11-27T01:00:02Z', error: 'NO_SITEMAP_URLS' },
    { runId: 's3', job: SITEMAP_IMPORT_JOB, workload: 'Website Inventory · example.com', status: 'running', startedAt: '2026-11-27T02:00:00Z', endedAt: null },
    { runId: 's4', job: SITEMAP_IMPORT_JOB, workload: 'Website Inventory · example.com', status: 'success', startedAt: null, endedAt: '2026-11-27T03:00:00Z' },
  ])
  assert.deepEqual(runs.map(r => [r.runId, r.status, r.startedAt, r.endedAt, r.items ?? null, r.error ?? null, r.parentRunId ?? null]), [
    ['s1', 'success', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:04.000Z', { total: 3, succeeded: 2 }, null, null],
    ['s2', 'failed', '2026-11-27T01:00:00.000Z', '2026-11-27T01:00:02.000Z', null, 'NO_SITEMAP_URLS', null],
    ['s3', 'running', '2026-11-27T02:00:00.000Z', null, null, null, null],
    ['s4', 'success', null, '2026-11-27T03:00:00.000Z', null, null, null],
  ])
  assert.deepEqual(labJobRecords(runs).map(r => [r.job, r.status, r.valid]), [[SITEMAP_IMPORT_JOB, 'completed', true], [SITEMAP_IMPORT_JOB, 'failed', false], [SITEMAP_IMPORT_JOB, 'completed', true]], 'running runs are not counted')
})

test('inventory table list drops the heavy text and keeps whether a summary exists', async () => {
  const { inventoryListRecord, INVENTORY_LIST_COLUMNS } = await import('./websiteInventory.ts')
  const full = { id: 'p1', url: 'https://x.com/a', title: 'A', status: 'active', topics: ['t'], eligibleForInternalLink: true, summary: 'Long summary', description: 'd', internalLinkAnchors: ['a'], keyClaims: ['c'], contentFingerprint: 'f', aiModel: 'llms.txt', summarizedAt: '2026-11-27T00:00:00Z' }
  const light = inventoryListRecord(full)
  assert.deepEqual(Object.keys(light).sort(), ['aiModel', 'eligibleForInternalLink', 'hasSummary', 'id', 'status', 'summarizedAt', 'title', 'topics', 'url'])
  assert.equal(light.hasSummary, true)
  assert.equal(inventoryListRecord({ id: 'p2', url: 'u' }).hasSummary, false)
  assert.equal(inventoryListRecord({ id: 'p3', url: 'u', summarizedAt: 'x' }).hasSummary, true, 'a list row from the light columns has summarized_at, not the text')
  for (const column of ['summary', 'key_claims', 'internal_link_anchors', 'description']) assert.ok(!INVENTORY_LIST_COLUMNS.split(', ').includes(column))
})
