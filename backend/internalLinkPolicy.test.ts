import assert from 'node:assert/strict'
import test from 'node:test'
import { internalLinkBudget, internalLinkInstruction, internalLinkChecks, addMissingInternalLinks } from '../src/lib/internalLinkPolicy.ts'
import { selectInternalLinkCandidates } from '../src/lib/internalLinkInventory.ts'
import { selectWebsiteCandidates } from './websiteInventory.ts'

const inventory = Array.from({ length: 10 }, (_, index) => ({ id: String(index), title: `Animation guide ${index}`, url: `https://example.com/guide-${index}`, status: 'active', eligibleForInternalLink: true, contentType: 'blog', topics: ['animation'] })) as any[]
const article = { topic: 'Animation', outline: [] } as any
const candidates = selectInternalLinkCandidates(article, inventory, 10)
const approved = inventory.map(item => item.url)
const draft = (count: number) => '# Article\n\nIntroduction.\n\n' + Array.from({ length: 8 }, (_, index) => `## Section ${index}\n\nUseful explanation.${index < count ? ` [Guide ${index}](${approved[index]})` : ''}`).join('\n\n') + '\n\n## Conclusion\n\nClosing advice.'

test('both execution modes use the same 5–7 contract for a 1500-word target', () => {
  assert.deepEqual(internalLinkBudget(1500), { target: 5, max: 7 })
  assert.match(internalLinkInstruction(1500, 10), /include 5–7 distinct/)
  assert.match(internalLinkInstruction(1500, 3), /Only 3 approved candidate/)
  assert.match(internalLinkInstruction(1500, 3), /do not fabricate/)
})
test('QC enforces both lower and upper bounds using the target rather than drifting with draft length', () => {
  for (const count of [3, 4, 5, 6, 7, 8]) {
    const checks = internalLinkChecks(draft(count), approved, 1500)
    assert.equal(checks[0].status, count >= 5 && count <= 7 ? 'pass' : 'fail')
    assert.equal(checks[1].status, 'pass')
  }
})
test('repeated canonical URLs do not count as distinct links and crowded sections fail distribution', () => {
  const repeated = '# Title\n\n## Section\n' + Array(5).fill('[Same](https://www.example.com/guide-0/?tracking=1#section)').join(' ')
  const checks = internalLinkChecks(repeated, approved, 1500)
  assert.equal(checks[0].status, 'fail')
  assert.match(checks[0].reason, /^1 unique/)
  assert.equal(checks[1].status, 'fail')
})
test('repair fills empty body sections up to five links without stacking links in the conclusion', () => {
  const fixed = addMissingInternalLinks(draft(3), candidates, approved, 1500)
  assert.ok(internalLinkChecks(fixed, approved, 1500).every(check => check.status === 'pass'))
  assert.ok(!fixed.split('## Conclusion')[1].includes('https://'))
  assert.equal(addMissingInternalLinks(fixed, candidates, approved, 1500), fixed)
})
test('insufficient inventory remains a visible shortage without invented or duplicated URLs', () => {
  const fixed = addMissingInternalLinks(draft(0), candidates.slice(0, 3), approved.slice(0, 3), 1500)
  assert.equal((fixed.match(/https:\/\//g) ?? []).length, 3)
  assert.equal(internalLinkChecks(fixed, approved.slice(0, 3), 1500)[0].status, 'fail')
})
test('server and browser share candidate selection including canonical URL deduplication', () => {
  assert.equal(selectWebsiteCandidates, selectInternalLinkCandidates)
  const duplicate = { ...inventory[0], id: 'duplicate', url: 'https://www.example.com/guide-0/?track=1' }
  assert.equal(selectWebsiteCandidates(article, [...inventory, duplicate], 20).length, 10)
  assert.deepEqual(selectWebsiteCandidates(article, inventory, 7), selectInternalLinkCandidates(article, inventory, 7))
})
