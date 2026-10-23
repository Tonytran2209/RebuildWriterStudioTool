import type { EvidenceRef } from "../types";
import type { DocBundle, DocRef } from "./docContext";
import { isClaimEvidence, hasRequiredEvidence, quoteSupportedBySource } from './evidencePolicy';

function canonical(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\u00ad/g, "")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteExists(content: string, quote: string): boolean {
  return quoteSupportedBySource(content, quote);
}

function docIndex(bundle: DocBundle): Map<string, { role: EvidenceRef["role"]; doc: DocRef }> {
  type IndexedDocument = readonly [string, { role: EvidenceRef["role"]; doc: DocRef }];
  const documents: IndexedDocument[] = [
    ...bundle.knowledgeBase.map(doc => [canonical(doc.name), { role: "kb" as const, doc }] as const),
    ...bundle.contentPlan.map(doc => [canonical(doc.name), { role: "content_plan" as const, doc }] as const),
    ...bundle.rules.map(doc => [canonical(doc.name), { role: "rules" as const, doc }] as const),
  ];
  const index = new Map<string, { role: EvidenceRef["role"]; doc: DocRef }>(documents);
  documents.forEach(([, match]) => {
    if (match.doc.id) index.set(canonical(match.doc.id), match);
  });
  const aliases = new Map<string, Array<{ role: EvidenceRef["role"]; doc: DocRef }>>();
  documents.forEach(([, match]) => {
    const basename = match.doc.name.split(/[\\/]/).pop() ?? match.doc.name;
    const stem = canonical(basename.replace(/\.[^.]+$/, ""));
    aliases.set(stem, [...(aliases.get(stem) ?? []), match]);
  });
  aliases.forEach((matches, alias) => {
    if (matches.length === 1 && !index.has(alias)) index.set(alias, matches[0]);
  });
  return index;
}

export function verifyEvidence(value: unknown, bundle: DocBundle): EvidenceRef[] {
  if (!Array.isArray(value)) return [];
  const index = docIndex(bundle);
  return value.flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const source = String(item.source ?? item.doc ?? item.name ?? "").trim();
    const quote = String(item.quote ?? item.excerpt ?? "").trim();
    const match = index.get(canonical(source));
    if (!match?.doc.content || !quoteExists(match.doc.content, quote)) return [];
    return [{ source: match.doc.name, role: match.role, quote, note: item.note ? String(item.note) : undefined }];
  });
}

export function verifiedRuleRefs(value: unknown, bundle: DocBundle): string[] {
  const allowed = new Map(bundle.rules.map(doc => [canonical(doc.name), doc.name]));
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;\n]/) : [];
  return [...new Set(values.map(item => allowed.get(canonical(String(item).trim()))).filter((item): item is string => Boolean(item)))];
}

export function hasResearchEvidence(evidence: EvidenceRef[]): boolean {
  return evidence.some(isClaimEvidence);
}

export function hasRulesEvidence(evidence: EvidenceRef[]): boolean {
  return evidence.some(item => item.role === "rules");
}

/** Require only the evidence groups that are actually available to the step. */
export function hasEvidenceForAuthorizedCategories(evidence: EvidenceRef[], bundle: DocBundle): boolean {
  const hasResearchDocs = Boolean(bundle.knowledgeBase.length);
  return hasRequiredEvidence(evidence, hasResearchDocs, Boolean(bundle.rules.length));
}
