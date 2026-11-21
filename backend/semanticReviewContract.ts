import { SEMANTIC_IDS } from '../src/lib/qualityPolicy.ts';

export function semanticReviewTokenBudget(recovery = false) {
  // Seven checks include reasoning and evidence in addition to JSON metadata.
  return recovery ? 12000 : 8000;
}

export function isCompleteSemanticReview(raw: string) {
  try {
    const payload = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    const entries = Array.isArray(payload.checks)
      ? payload.checks.map((check: any) => [check?.id, check])
      : Object.entries(payload.checks ?? {});
    const checks = entries.filter(([id, check]: any[]) =>
      SEMANTIC_IDS.includes(id) && check && ['pass', 'warning', 'fail'].includes(check.status));
    const present = new Set(checks.map(([id]: any[]) => id));
    return present.size === checks.length && SEMANTIC_IDS.every(id => present.has(id));
  } catch {
    return false;
  }
}
