import type { Article, QualityGateCheck, UniversalQualityReport, WebsiteContentRecord } from "../types";
import { articleSpecFingerprint } from "./articleSpec";

export const UNIVERSAL_QUALITY_VERSION = 2;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const normalized = (text: string) => text.toLocaleLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const links = (text: string) => [...text.matchAll(/https?:\/\/[^\s)\]}>"']+/gi)].map(match => match[0].replace(/[.,;:!?]+$/, ""));

export function deterministicQualityChecks(article: Article, draft: string, effectiveWordLimit: number, inventory: WebsiteContentRecord[] = [], sourceNames: string[] = []): QualityGateCheck[] {
  const spec = article.articleSpec;
  const body = normalized(draft);
  const hardLimit = Math.min(10000, Math.max(800, effectiveWordLimit || 1500));
  const targetMin = Math.ceil(hardLimit * .9);
  const count = words(draft);
  const approvedUrls = new Set(inventory.filter(item => item.eligibleForInternalLink && (item.status === "active" || item.status === "redirected")).flatMap(item => [item.url, item.canonicalUrl, item.redirectTarget].filter(Boolean) as string[]));
  const inventoryHosts = new Set([...approvedUrls].flatMap(value => { try { return [new URL(value).hostname]; } catch { return []; } }));
  const draftLinks = links(draft).filter(value => { try { return inventoryHosts.has(new URL(value).hostname); } catch { return false; } });
  const leaked = sourceNames.filter(name => name && draft.toLowerCase().includes(name.toLowerCase()));
  const missingCoverage = (spec?.mustCover ?? []).filter(topic => {
    const terms = normalized(topic).split(" ").filter(term => term.length > 3);
    return terms.length > 0 && terms.filter(term => body.includes(term)).length < Math.ceil(terms.length * 0.5);
  });
  const checks: QualityGateCheck[] = [
    { id: "complete-structure", label: "Complete article structure", kind: "deterministic", status: /^#\s+/m.test(draft) && /^##\s+/m.test(draft) ? "pass" : "fail", reason: "Draft must contain one H1 and at least one H2.", autoFixAllowed: true },
    { id: "word-budget", label: "English word budget", kind: "deterministic", status: count >= targetMin && count <= hardLimit ? "pass" : "fail", reason: `${count} English words; accepted range ${targetMin}–${hardLimit} from the Step 3 setting.`, autoFixAllowed: true },
    { id: "primary-query", label: "Primary query coverage", kind: "deterministic", status: spec?.primaryQuery && body.includes(normalized(spec.primaryQuery)) ? "pass" : "fail", reason: "The primary query must appear naturally in the article.", evidence: spec?.primaryQuery, autoFixAllowed: true },
    { id: "must-cover", label: "Must-cover topics", kind: "deterministic", status: missingCoverage.length ? "fail" : "pass", reason: missingCoverage.length ? `Missing: ${missingCoverage.join(", ")}` : "Every required topic has lexical coverage.", autoFixAllowed: true },
    { id: "placeholders", label: "No placeholders", kind: "deterministic", status: /\[(?:cần|needs?|todo|tbd)[^\]]*\]|lorem ipsum|about:blank/i.test(draft) ? "fail" : "pass", reason: "Draft must not contain placeholders or about:blank.", autoFixAllowed: true },
    { id: "source-confidentiality", label: "No internal source leakage", kind: "deterministic", status: leaked.length ? "fail" : "pass", reason: leaked.length ? `Leaked source names: ${leaked.join(", ")}` : "No infrastructure filenames detected.", autoFixAllowed: false },
    { id: "link-correctness", label: "Approved internal links", kind: "deterministic", status: draftLinks.every(url => approvedUrls.has(url)) ? "pass" : "fail", reason: draftLinks.length ? "Every URL must exist in the approved website inventory." : "No unapproved URL detected.", evidence: draftLinks.join(", "), autoFixAllowed: false },
  ];
  return checks;
}

export function qualityReport(article: Article, checks: QualityGateCheck[]): UniversalQualityReport {
  const status = checks.some(item => item.status === "fail") ? "fail" : checks.some(item => item.status === "warning") ? "warning" : "pass";
  return { version: UNIVERSAL_QUALITY_VERSION, status, checkedAt: new Date().toISOString(), articleSpecFingerprint: article.articleSpec ? articleSpecFingerprint(article.articleSpec) : "missing-spec", checks };
}
