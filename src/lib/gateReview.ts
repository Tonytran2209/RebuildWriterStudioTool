/**
 * G1/G2 AI self-review against the Gate's Standards (design: .agent-hub/backend/gate-documents-v2.md §5.2).
 * The reviewed output and its hash are shared by the server (review) and the CRM (stale check).
 */
import type { Article, GateReview } from '../types/index.ts';
import { structureHash } from '../../shared/outlineStructures.ts';

/** The part of a Gate's output a reviewer sees and a fix may change. Evidence is left out: it is verified by code. */
export function gateReviewOutput(article: Partial<Article>, step: 2 | 3) {
  if (step === 2) {
    const idea = article.coreIdeaSuggestions?.find(item => item.id === article.selectedCoreIdeaId) ?? article.coreIdeaSuggestions?.[0];
    const { evidence: _evidence, createdAt: _createdAt, ...spec } = (article.articleSpec ?? {}) as Record<string, unknown>;
    return {
      articleSpec: spec,
      idea: idea ? { title: idea.title, angleLabel: idea.angleLabel, angleDescription: idea.angleDescription, mainArgument: idea.mainArgument, primaryKeyword: idea.primaryKeyword, secondaryKeywords: idea.secondaryKeywords, targetAudience: idea.targetAudience, recommendedTone: idea.recommendedTone } : null,
    };
  }
  return { outline: (article.outline ?? []).map(({ id, level, heading, notes, keywords, searchIntent, rationale }) => ({ id, level, heading, notes, keywords, searchIntent, rationale })) };
}
export const gateReviewHash = (article: Partial<Article>, step: 2 | 3) => structureHash(JSON.stringify(gateReviewOutput(article, step)));

export function gateReviewStatus(checks: GateReview['checks']): GateReview['status'] {
  return checks.some(check => check.status === 'fail') ? 'fail' : checks.some(check => check.status === 'warning') ? 'warning' : 'pass';
}

/** Review saved on the article for a Gate, with whether the output changed since it was reviewed. */
export function gateReviewState(article: Partial<Article>, step: 2 | 3) {
  const review = article.gateReviews?.[step];
  return review ? { review, stale: review.outputHash !== gateReviewHash(article, step) } : null;
}
