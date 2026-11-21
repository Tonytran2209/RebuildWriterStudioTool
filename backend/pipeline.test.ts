import { splitPlanByPublishingWave } from "./stepContext.ts"
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PIPELINE, rerunPatch, aiApproval, articleStage, firstPassApprovalRate, inReviewSample, pipelineSettings } from '../src/lib/pipeline.ts'
import type { Article } from '../src/types/index.ts'

const base = { id: 'a', title: 'T', currentStep: 2, status: 'in_progress', createdAt: '', updatedAt: '' } as Article
const check = (id: string, status: 'pass' | 'warning' | 'fail', blocking = false) => ({ id, label: id, kind: 'semantic' as const, status, reason: '', autoFixAllowed: false, blocking })

test('existing steps map onto gates in order', () => {
  assert.equal(articleStage(base), 'g1')
  assert.equal(articleStage({ ...base, activityKind: 'batch', batchStatus: 'queued' }), 'queued')
  assert.equal(articleStage({ ...base, selectedCoreIdeaId: 'x' }), 'g2')
  assert.equal(articleStage({ ...base, selectedCoreIdeaId: 'x', outline: [{ id: 's', heading: 'h', notes: '', level: 'h2' }] }), 'g3')
  assert.equal(articleStage({ ...base, draft: '# D' }), 'ai')
  assert.equal(articleStage({ ...base, draft: '# D', batchStatus: 'failed' }), 'failed')
  assert.equal(articleStage({ ...base, draft: '# D', status: 'done' }), 'completed')
})

test('AI approval: score vs threshold, hard block on unsupported evidence', () => {
  const settings = DEFAULT_PIPELINE
  assert.equal(aiApproval(base, settings).state, 'pending')
  const passing = { ...base, qualityReport: { version: 1, status: 'pass', checkedAt: '', articleSpecFingerprint: '', checks: Array.from({ length: 10 }, (_, i) => check('c' + i, 'pass')) } } as Article
  assert.deepEqual([aiApproval(passing, settings).state, aiApproval(passing, settings).score], ['approved', 100])
  const oneWarning = { ...passing, qualityReport: { ...passing.qualityReport!, checks: [...passing.qualityReport!.checks.slice(1), check('w', 'warning')] } }
  assert.equal(aiApproval(oneWarning, settings).score, 95)
  const evidenceFail = { ...passing, qualityReport: { ...passing.qualityReport!, checks: [...Array.from({ length: 19 }, (_, i) => check('p' + i, 'pass')), check('evidence-support', 'fail')] } }
  assert.equal(aiApproval(evidenceFail, settings).score, 95)
  assert.equal(aiApproval(evidenceFail, settings).state, 'rejected')
  assert.equal(aiApproval(oneWarning, pipelineSettings({ pipeline: { threshold: 96 } })).state, 'rejected')
  assert.equal(firstPassApprovalRate([base, passing, evidenceFail], settings), 50)
})

test('review sample is stable per article and respects 0/100', () => {
  assert.equal(inReviewSample('abc', 20), inReviewSample('abc', 20))
  assert.equal(inReviewSample('abc', 0), false)
  assert.equal(inReviewSample('abc', 100), true)
})

test('rerun clears the chosen gate and everything after it, and queues the article as a batch', () => {
  const g2 = rerunPatch({ id: 'a1', activityKind: 'batch', activityId: 'b1' }, 2)
  assert.deepEqual([g2.outline, g2.outlineNeedsRegeneration, g2.draft, g2.qualityReport, g2.batchStatus], [[], true, '', null, 'queued'])
  assert.equal('coreIdeaSuggestions' in g2, false)
  assert.equal('activityId' in g2, false)
  const g4 = rerunPatch({ id: 'a1', activityKind: 'batch', activityId: 'b1' }, 4)
  assert.equal('draft' in g4, false)
  assert.equal(g4.qualityReport, null)
  const single = rerunPatch({ id: 'a2', activityKind: 'single' }, 3)
  assert.deepEqual([single.activityKind, single.activityId, single.draftNeedsRegeneration], ['batch', 'activity-a2', true])
  assert.deepEqual(rerunPatch({ id: 'a3' }, 1).coreIdeaSuggestions, [])
})

test('re-running G3 shows G3, not AI Approval, while the draft is regenerated', () => {
  assert.equal(articleStage({ ...base, outline: [{ id: 's', heading: 'h', notes: '', level: 'h2' }], draft: '# D', draftNeedsRegeneration: true }), 'g3')
})

test('rerun patch restores the plan topic on G1 and drops approvals', () => {
  const article = { ...base, activityKind: 'batch' as const, activityId: 'b', topic: 'Chosen idea title', selectedContentTypeSnapshot: { id: 'i', label: 'Plan topic', description: '', keywords: ['k1', 'k2'] } }
  const g1 = rerunPatch(article, 1)
  assert.equal(g1.topic, 'Plan topic')
  assert.equal(g1.title, 'Plan topic')
  assert.equal(g1.keywords, 'k1, k2')
  assert.equal(g1.approvedArticle, null)
  assert.equal(g1.editorialApproval, null)
  const g3 = rerunPatch(article, 3)
  assert.equal(g3.topic, undefined)
  assert.equal(g3.approvedArticle, null)
  assert.equal('editorialApproval' in g3, false)
})

test('CRM status: a running article ignores an old passing QC report; awaiting Editorial is shown at G2', async () => {
  const { toCrmArticle } = await import('../src/crm/model.ts')
  const passing = { version: 1, status: 'pass', checkedAt: '', articleSpecFingerprint: '', checks: Array.from({ length: 10 }, (_, i) => check('c' + i, 'pass')) } as any
  const running = toCrmArticle({ ...base, activityKind: 'batch', batchStatus: 'queued', coreIdeaSuggestions: [{ id: 'x' } as any], qualityReport: passing }, DEFAULT_PIPELINE)
  assert.equal(running.status, 'running')
  const done = toCrmArticle({ ...base, activityKind: 'batch', batchStatus: 'failed', qualityReport: passing }, DEFAULT_PIPELINE)
  assert.equal(done.status, 'failed')
  const waiting = toCrmArticle({ ...base, activityKind: 'batch', activityType: 'editorial-originality', batchStatus: 'awaiting_approval', selectedCoreIdeaId: 'x', outline: [{ id: 's', heading: 'h', notes: '', level: 'h2' }] }, DEFAULT_PIPELINE)
  assert.deepEqual([waiting.status, waiting.gate, waiting.awaiting], ['running', 2, true])
})

test("Content Plan Wave classification preserves preamble and all topic lines", () => {
  const input = [
    "Topic before Wave headings",
    "The plan refers to Wave 4 in an editorial note",
    "## Wave 1 — Tháng 11",
    "First Wave topic",
    "Publishing Wave 2 — Q1 2027",
    "Second Wave topic",
  ]
  assert.deepEqual(splitPlanByPublishingWave(input.join("\r\n")), [
    input.slice(0, 2),
    input.slice(2, 4),
    input.slice(4),
  ])
})
