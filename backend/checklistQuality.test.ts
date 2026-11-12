import assert from 'node:assert/strict'
import test from 'node:test'
import { primaryKeyword, step4ChecklistDocs, checklistReviewInstruction, semanticReviewInputFingerprint, CHECKLIST_MAX_CHARS } from '../src/lib/qualityPolicy.ts'
import { deterministicQualityChecks } from '../src/lib/universalQuality.ts'
import type { Article } from '../src/types/index.ts'

test('primary keyword falls through empty sources in one fixed order', () => {
  assert.equal(primaryKeyword({ articleSpec: { primaryQuery: ' ' } as any, keywords: 'medical animation, other', topic: 'T' }), 'medical animation')
  assert.equal(primaryKeyword({ articleSpec: { primaryQuery: 'spec query' } as any, keywords: 'kw' }), 'spec query')
  assert.equal(primaryKeyword({ topic: 'topic only' }), 'topic only')
})

test('checklist uses only Rules granted to Step 4, excluding the MD outline structure', () => {
  const files = [
    { id: 'seo', name: 'SEO checklist.md', category: 'rules', content: '- Answer the query in the first paragraph' },
    { id: 'other', name: 'Step 2 rules.md', category: 'rules', content: 'not for drafts' },
    { id: 'md', name: 'Structure.md', category: 'rules', content: 'outline structure' },
    { id: 'kb1', name: 'KB.pdf', category: 'kb', content: 'facts' },
  ]
  const config = { stepConfigs: { 4: { fileAccess: { rules: ['seo', 'md', 'kb1'] } } } }
  const docs = step4ChecklistDocs(files, config, { outlineStructure: { sourceId: 'md' } as any })
  assert.deepEqual(docs.map(doc => doc.name), ['SEO checklist.md'])
  assert.match(checklistReviewInstruction(docs), /Answer the query in the first paragraph/)
  assert.match(checklistReviewInstruction([]), /No checklist assigned to Step 4/)
  assert.match(checklistReviewInstruction([{ name: 'big', content: 'x'.repeat(CHECKLIST_MAX_CHARS + 10) }]), /\[checklist truncated\]/)
})

test('editing the checklist invalidates the cached semantic review', () => {
  const article = { outline: [] } as unknown as Article
  assert.notEqual(semanticReviewInputFingerprint(article, '# D', {}, 'rule A'), semanticReviewInputFingerprint(article, '# D', {}, 'rule B'))
})

test('Universal QC owns the former SEO checklist: H1 keyword, single Conclusion, Unicode keywords', () => {
  const article = { articleSpec: { primaryQuery: 'hoạt hình y khoa' }, outline: [] } as unknown as Article
  const byId = (draft: string) => Object.fromEntries(deterministicQualityChecks(article, draft, 1500).map(check => [check.id, check.status]))
  const good = byId('# Hoạt hình y khoa là gì\n\nIntro.\n\n## Body\n\nText.\n\n## Conclusion\n\nEnd.')
  assert.equal(good['title-keyword'], 'pass')
  assert.equal(good['primary-query'], 'pass')
  assert.equal(good['single-conclusion'], 'pass')
  const bad = byId('# Another title\n\n## Body\n\nText about hoạt hình y khoa.')
  assert.equal(bad['title-keyword'], 'fail')
  assert.equal(bad['primary-query'], 'pass')
  assert.equal(bad['single-conclusion'], 'fail')
})
