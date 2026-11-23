import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertStructuredDraftFields, isCompleteStructuredDraft, structuredDraftTokenBudget } from './draftContract.ts';

test('1500-word drafts and recovery have headroom beyond the production truncation limit', () => {
  assert.equal(structuredDraftTokenBudget(1500), 8000);
  assert.equal(structuredDraftTokenBudget(1500, true), 12000);
  assert.equal(structuredDraftTokenBudget(10000, true), 24000);
});

test('truncated JSON and incomplete drafts cannot be reused from cache', () => {
  const draft = { title: 'Title', introduction: 'Intro', sections: [{ id: 's1', content: 'Body', usedEvidenceRefs: [] }], conclusion: 'Conclusion' };
  assert.equal(isCompleteStructuredDraft(JSON.stringify(draft)), true);
  assert.equal(isCompleteStructuredDraft(JSON.stringify(draft).slice(0, -20)), false);
  assert.equal(isCompleteStructuredDraft(JSON.stringify({ ...draft, conclusion: '' })), false);
  assert.equal(isCompleteStructuredDraft(JSON.stringify({ ...draft, sections: [] })), false);
  assert.throws(() => assertStructuredDraftFields({ ...draft, conclusion: '' }), /conclusion/);
});
