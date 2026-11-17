import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PIPELINE, aiApproval, articleStage, firstPassApprovalRate, inReviewSample, pipelineSettings } from '../src/lib/pipeline.ts'
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
