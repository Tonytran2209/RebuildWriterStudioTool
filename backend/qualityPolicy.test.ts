import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalSpecFingerprint, qualityInputFingerprint, blocksPublication, qualityAllowsCompletion, SEMANTIC_IDS } from '../src/lib/qualityPolicy.ts'
import { isClaimEvidence, knowledgeExcerpts, sectionEvidence, declaredEvidenceUsage, remapEvidenceUsage, hasRequiredEvidence, quoteSupportedBySource } from '../src/lib/evidencePolicy.ts'
import type { ArticleSpec, Article, DocumentFile, QualityGateCheck, EvidenceRef } from '../src/types/index.ts'

const spec = { version: 1, topic: 'Medical animation', evidence: [], createdAt: '2026-10-23' } as unknown as ArticleSpec
const article = { articleSpec: spec, keywords: 'medical', outline: [] } as unknown as Article
const kb = { source: 'Expert KB', role: 'kb', quote: 'Medical animation production begins by reviewing the script with a clinical expert.' } as EvidenceRef
const title = { source: 'Plan', role: 'content_plan', quote: 'Medical Animation vs Medical Illustration: Comparing Healthcare Communication Formats' } as EvidenceRef

test('canonical specification fingerprint ignores creation time, evidence notes and object key order', () => {
  const first = { ...spec, evidence: [{ ...kb, note: 'first note' }] }
  const second = { createdAt: 'later', evidence: [{ note: 'other note', quote: kb.quote, role: kb.role, source: kb.source }], topic: spec.topic, version: spec.version } as ArticleSpec
  assert.equal(canonicalSpecFingerprint(first), canonicalSpecFingerprint(second))
  assert.notEqual(canonicalSpecFingerprint(spec), canonicalSpecFingerprint({ ...spec, topic: 'Changed topic' }))
})
test('server and browser inputs yield the same review fingerprint despite legacy SHA metadata', () => {
  const batch = { ...article, articleSpecFingerprint: 'old-sha256', activityKind: 'batch' } as Article
  const browser = { ...article, articleSpecFingerprint: canonicalSpecFingerprint(spec) }
  assert.equal(qualityInputFingerprint(batch, 'Draft', 1500), qualityInputFingerprint(browser, 'Draft', 1500))
})
test('review invalidates only when actual reviewed inputs change', () => {
  const files = [{ id: 'kb', name: 'KB', category: 'kb', content: 'Original source' }] as DocumentFile[]
  const key = qualityInputFingerprint(article, 'Draft', 1500, files)
  assert.notEqual(key, qualityInputFingerprint(article, 'Edited draft', 1500, files))
  assert.notEqual(key, qualityInputFingerprint(article, 'Draft', 1800, files))
  assert.notEqual(key, qualityInputFingerprint(article, 'Draft', 1500, files, { draft: { customInstruction: 'New editorial constraint' } }))
  assert.notEqual(key, qualityInputFingerprint(article, 'Draft', 1500, [{ ...files[0], content: 'Changed source' }]))
  assert.equal(key, qualityInputFingerprint({ ...article, modelId: 'other-model' } as Article, 'Draft', 1500, files))
})
test('plan titles and style rules are not factual claim evidence', () => {
  assert.equal(isClaimEvidence(title), false)
  assert.equal(isClaimEvidence({ ...kb, role: 'rules' }), false)
  assert.equal(isClaimEvidence(kb), true)
  assert.equal(hasRequiredEvidence([title], true, false), false)
  assert.equal(hasRequiredEvidence([kb], true, false), true)
})
test('a real excerpt cannot conceal an invented sentence in a multi-part quotation', () => {
  assert.equal(quoteSupportedBySource(kb.quote!, `${kb.quote} Invented clinical outcome.`), false)
  assert.equal(quoteSupportedBySource(kb.quote!, kb.quote!), true)
  assert.equal(quoteSupportedBySource('Reviewed script and clinical expert.\n\nBudget planning is important to production.', 'Reviewed script and clinical expert. … Budget planning is important to production.'), true)
})
test('section retrieval selects related KB excerpts instead of copying one quote to every section', () => {
  const candidates = knowledgeExcerpts([
    { name: 'Expert KB', content: `${kb.quote}\n\nBudget planning requires a producer to review project costs and delivery milestones.` },
  ])
  assert.equal(sectionEvidence([...candidates, title], 'Medical animation clinical script')[0].quote, kb.quote)
  assert.match(sectionEvidence(candidates, 'Budget costs delivery milestones')[0].quote ?? '', /Budget planning/)
  assert.deepEqual(sectionEvidence(candidates, 'Unrelated underwater photography'), [])
})
test('empty evidence usage stays empty; foreign IDs are never promoted into usage', () => {
  const sections = [{ id: 'a', evidenceRefs: ['ev-1'] }, { id: 'b', evidenceRefs: ['ev-2'] }]
  assert.deepEqual(declaredEvidenceUsage(sections, {}), { a: [], b: [] })
  assert.deepEqual(declaredEvidenceUsage(sections, { a: ['ev-2'], b: ['ev-2'] }), { a: [], b: ['ev-2'] })
})
test('legacy plan references are not reassigned to a KB quote when registry IDs shift', () => {
  assert.deepEqual(remapEvidenceUsage({ 'ev-1': title, 'ev-2': kb }, [{ id: 'a', evidenceRefs: ['ev-1'] }], { 'ev-1': kb }, { a: ['ev-1'] }), { a: [] })
  assert.deepEqual(remapEvidenceUsage({ 'ev-1': title, 'ev-2': kb }, [{ id: 'a', evidenceRefs: ['ev-1'] }], { 'ev-1': kb }, { a: ['ev-2'] }), { a: ['ev-1'] })
})
test('advisory warnings can complete, but unsupported evidence and incomplete or stale reviews cannot', () => {
  const checks = SEMANTIC_IDS.map(id => ({ id, kind: 'semantic', status: 'pass', label: id, reason: '', autoFixAllowed: false })) as QualityGateCheck[]
  const advisory = checks.map(item => item.id === 'brand-pov' ? { ...item, status: 'warning' as const } : item)
  assert.equal(qualityAllowsCompletion(advisory), true)
  for (const id of ['evidence-support', 'semantic-review-schema', 'quality-review-stale']) {
    const warning = { ...checks[0], id, status: 'warning' as const, blocking: false }
    assert.equal(blocksPublication(warning), true)
    assert.equal(qualityAllowsCompletion([...checks, warning]), false)
  }
  assert.equal(qualityAllowsCompletion(checks.slice(0, 5)), false)
  assert.equal(qualityAllowsCompletion([...checks, { ...checks[0], status: 'fail' }]), false)
})
