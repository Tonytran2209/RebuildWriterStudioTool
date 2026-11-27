import assert from 'node:assert/strict'
import test from 'node:test'
import { competitorUrls, findCannibalisation, keywordTokens } from '../src/lib/researchPolicy.ts'

test('competitor URLs: research order, unique pages, never the brand\'s own site, capped', () => {
  const keywords = [
    { sources: ['https://www.rival.com/guide/', 'https://flearningstudio.com/blog/x', 'https://rival.com/guide'] },
    { sources: ['https://other.io/a', 'not a url', 'https://third.net/b', 'https://fourth.org/c'] },
  ]
  const inventory = [{ url: 'https://www.flearningstudio.com/' }]
  assert.deepEqual(competitorUrls(keywords, inventory, 3), ['https://www.rival.com/guide/', 'https://other.io/a', 'https://third.net/b'])
  assert.deepEqual(competitorUrls([], inventory), [])
})

test('cannibalisation: overlapping keyword or title is flagged; unrelated, broken and self are not', () => {
  assert.deepEqual([...keywordTokens('10 Best Medical Animation Companies 2026')], ['10', 'medical', 'animation', 'company'])
  const inventory: any[] = [
    { id: 'p1', url: 'https://x.com/medical-animation', title: 'Medical Animation Companies Compared', status: 'active', primaryTopic: 'medical animation companies' },
    { id: 'p2', url: 'https://x.com/old', title: 'Medical animation companies', status: 'broken' },
    { id: 'p3', url: 'https://x.com/pricing', title: 'Pricing', status: 'active', primaryTopic: '2d animation cost' },
  ]
  const articles: any[] = [
    { id: 'me', title: 'Best medical animation companies', articleSpec: { primaryQuery: 'medical animation companies' } },
    { id: 'a2', title: 'Top Medical Animation Studios', articleSpec: { primaryQuery: 'medical animation studios' } },
    { id: 'a3', title: 'What is whiteboard animation', articleSpec: { primaryQuery: 'whiteboard animation' } },
  ]
  const matches = findCannibalisation({ id: 'me', primaryQuery: 'medical animation companies', title: 'Best Medical Animation Companies in 2026' }, inventory, articles)
  assert.deepEqual(matches.map(m => [m.kind, m.id, m.score]), [['page', 'p1', 1]])
  const loose = findCannibalisation({ id: 'me', primaryQuery: 'medical animation companies' }, [], articles, 0.5)
  assert.deepEqual(loose.map(m => m.id), ['a2'], 'two shared words out of four is 0.5')
  assert.deepEqual(findCannibalisation({ id: 'me', primaryQuery: '' }, inventory, articles), [])
})
