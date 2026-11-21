import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEMANTIC_IDS } from '../src/lib/qualityPolicy.ts';
import { isCompleteSemanticReview, semanticReviewTokenBudget } from './semanticReviewContract.ts';

test('review and recovery allow room beyond the observed 1600-token cutoff', () => {
  assert.equal(semanticReviewTokenBudget(), 8000);
  assert.equal(semanticReviewTokenBudget(true), 12000);
});

test('review cache rejects truncated JSON, missing checks and invalid statuses', () => {
  const checks = Object.fromEntries(SEMANTIC_IDS.map(id => [id, { status: 'pass' }]));
  const raw = JSON.stringify({ checks });
  assert.equal(isCompleteSemanticReview(raw), true);
  assert.equal(isCompleteSemanticReview(raw.slice(0, -10)), false);
  assert.equal(isCompleteSemanticReview(JSON.stringify({ checks: { 'intent-satisfied': { status: 'pass' } } })), false);
  assert.equal(isCompleteSemanticReview(JSON.stringify({ checks: { ...checks, 'brand-pov': { status: 'unknown' } } })), false);
  assert.equal(isCompleteSemanticReview(JSON.stringify({ checks: SEMANTIC_IDS.map(id => ({ id, status: 'warning' })) })), true);
  assert.equal(isCompleteSemanticReview(JSON.stringify({ checks: [...SEMANTIC_IDS, SEMANTIC_IDS[0]].map(id => ({ id, status: 'pass' })) })), false);
});
