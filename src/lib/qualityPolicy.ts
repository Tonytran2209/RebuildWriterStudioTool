import type { Article, ArticleSpec, DocumentFile, QualityGateCheck } from '../types/index.ts';

export const QUALITY_VERSION = 9;
export const SEMANTIC_IDS = ['intent-satisfied', 'reader-outcome', 'intro-quality', 'keyword-naturalness', 'evidence-support', 'brand-pov'];

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
}
function fingerprint(value: unknown) {
  const text = JSON.stringify(stable(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16);
}
export function canonicalSpecFingerprint(spec: ArticleSpec): string {
  return `spec-2-${fingerprint({ ...spec, createdAt: undefined, evidence: (spec.evidence ?? []).map(({ source, quote, role }) => ({ source, quote, role })) })}`;
}

// Identical input contract for server batches and browser re-checks. Model
// choice and UI settings do not invalidate a review of unchanged content.
export function qualityInputFingerprint(article: Partial<Article>, draft: string, targetWords: number, files: DocumentFile[] = [], rules: any = {}) {
  const sources = files.filter(file => ['kb', 'rules'].includes(file.category)).map(file => ({ id: file.id, name: file.name, category: file.category, content: file.content ?? '' })).sort((a, b) => a.id.localeCompare(b.id));
  const workflow = ['source-grounding', 'draft', 'quality-persistence'].map(id => {
    const setting = rules?.[id] ?? {};
    return { id, enforcement: setting.enforcement ?? 'strict', customInstruction: setting.customInstruction ?? '', appliesTo: { manual: true, batch: true, ...setting.appliesTo }, stageOverrides: setting.stageOverrides ?? {} };
  });
  return `qc-${QUALITY_VERSION}-${fingerprint({ draft, spec: article.articleSpec ? canonicalSpecFingerprint(article.articleSpec) : null, outline: article.outline ?? [], keywords: article.keywords, targetWords, sources, workflow })}`;
}

export function blocksPublication(check: { id: string; status: string; kind: string; blocking?: boolean }): boolean {
  if (check.status === 'fail') return true;
  if (check.status !== 'warning') return false;
  // Evidence and incomplete/stale reviews must never be waived as cosmetic.
  return check.id === 'evidence-support' || check.id === 'semantic-review-schema' || check.id === 'quality-review-stale' || check.blocking === true || (check.kind === 'deterministic' && check.blocking !== false);
}
export function qualityAllowsCompletion(checks: QualityGateCheck[]) {
  return SEMANTIC_IDS.every(id => checks.some(check => check.kind === 'semantic' && check.id === id)) && !checks.some(blocksPublication);
}

export const EVIDENCE_REVIEW_INSTRUCTION = 'EVIDENCE CONTRACT: Content Plan establishes topic/intent only; Rules establish style only. Neither is factual evidence. Only supplied KB excerpts can support factual or expert claims. A registered/mapped ID does not prove that a claim is supported. Evaluate actual prose against the quote. General explanatory prose and clearly framed editorial decision guidance do not require citations and may pass. For an unsupported concrete claim (statistics, measured effects, healthcare outcomes, product capabilities), quote the exact claim and its section location; fail blocking claims. If support is unavailable, recommend adding verified KB evidence or removing/qualifying that claim. Never request external research automatically or invent evidence. Do not warn merely because a general explanation lacks a citation.';
