import type { ArticleSpec, EvidenceRef, SearchIntent, SeoResearchResult } from "../types";

export const ARTICLE_SPEC_VERSION = 1;

const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))]
  : typeof value === "string"
    ? [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))]
    : [];

const intent = (value: unknown): SearchIntent => {
  const normalized = String(value ?? "").toLowerCase();
  return (["informational", "commercial", "transactional", "navigational"] as const).find(item => item === normalized) ?? "informational";
};

export function normalizeArticleSpec(
  value: unknown,
  fallback: { topic: string; audience?: string; market?: string; language?: string; evidence?: EvidenceRef[]; research?: SeoResearchResult },
): ArticleSpec {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const researched = fallback.research?.keywords.map(item => item.keyword) ?? [];
  return {
    version: ARTICLE_SPEC_VERSION,
    topic: String(input.topic ?? fallback.topic).trim(),
    primaryQuery: String(input.primaryQuery ?? researched[0] ?? fallback.topic).trim(),
    secondaryQueries: stringArray(input.secondaryQueries ?? researched.slice(1, 6)),
    audience: String(input.audience ?? fallback.audience ?? "").trim(),
    market: String(input.market ?? fallback.market ?? "USA").trim() || "USA",
    language: String(input.language ?? fallback.language ?? "English").trim() || "English",
    primaryIntent: intent(input.primaryIntent),
    secondaryIntent: input.secondaryIntent ? intent(input.secondaryIntent) : undefined,
    expectedReaderOutcome: String(input.expectedReaderOutcome ?? "").trim(),
    winningFormat: String(input.winningFormat ?? "article").trim(),
    mustCover: stringArray(input.mustCover),
    optionalCoverage: stringArray(input.optionalCoverage),
    thesis: String(input.thesis ?? "").trim(),
    brandPov: String(input.brandPov ?? "").trim(),
    evidence: fallback.evidence ?? [],
    ctaObjective: String(input.ctaObjective ?? "").trim(),
    internalLinkRequirements: stringArray(input.internalLinkRequirements),
    createdAt: new Date().toISOString(),
  };
}

export function articleSpecFingerprint(spec: ArticleSpec): string {
  const payload = JSON.stringify({ ...spec, createdAt: undefined, evidence: spec.evidence.map(item => ({ source: item.source, quote: item.quote, role: item.role })) });
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) { hash ^= payload.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `spec-${ARTICLE_SPEC_VERSION}-${(hash >>> 0).toString(16)}`;
}
