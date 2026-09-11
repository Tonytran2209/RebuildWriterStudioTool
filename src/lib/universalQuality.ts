import type { Article, QualityGateCheck, UniversalQualityReport, WebsiteContentRecord } from "../types";
import { articleSpecFingerprint } from "./articleSpec";

export const UNIVERSAL_QUALITY_VERSION = 5;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const normalized = (text: string) => text.toLocaleLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const links = (text: string) => [...text.matchAll(/https?:\/\/[^\s)\]}>"']+/gi)].map(match => match[0].replace(/[.,;:!?]+$/, ""));
const canonicalUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, "");
    url.protocol = "https:";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
};

export function auditInternalLinks(article: Article, draft: string, inventory: WebsiteContentRecord[] = []) {
  const approvedUrls = new Set(inventory.filter(item => item.eligibleForInternalLink && (item.status === "active" || item.status === "redirected")).flatMap(item => [item.url, item.canonicalUrl, item.redirectTarget].filter(Boolean) as string[]).map(canonicalUrl));
  const inventoryHosts = new Set([...approvedUrls].flatMap(value => { try { return [new URL(value).hostname.replace(/^www\./, "")]; } catch { return []; } }));
  const internalUrls = links(draft).filter(value => { try { return inventoryHosts.has(new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, "")); } catch { return false; } });
  const approvedDraftUrls = internalUrls.filter(url => approvedUrls.has(canonicalUrl(url)));
  const unapprovedUrls = internalUrls.filter(url => !approvedUrls.has(canonicalUrl(url)));
  const required = Boolean(article.articleSpec?.internalLinkRequirements?.length);
  return { approvedUrls, internalUrls, approvedDraftUrls, unapprovedUrls, required };
}

export function deterministicQualityChecks(article: Article, draft: string, effectiveWordLimit: number, inventory: WebsiteContentRecord[] = [], sourceNames: string[] = []): QualityGateCheck[] {
  const spec = article.articleSpec;
  const body = normalized(draft);
  const wordTarget = Math.min(10000, Math.max(800, effectiveWordLimit || 1500));
  const acceptedMin = Math.max(800, Math.ceil(wordTarget * 0.85));
  const acceptedMax = Math.floor(wordTarget * 1.15);
  const count = words(draft);
  const linkAudit = auditInternalLinks(article, draft, inventory);
  const leaked = sourceNames.filter(name => /\.[a-z0-9]{1,8}$/i.test(name.trim()) && draft.toLowerCase().includes(name.trim().toLowerCase()));
  const outlineCoverage = normalized((article.outline ?? []).flatMap(section => [section.heading, section.notes, section.rationale, ...(section.keywords ?? [])]).join(" "));
  const missingCoverage = (spec?.mustCover ?? []).filter(topic => {
    const terms = normalized(topic).split(" ").filter(term => term.length > 3);
    return terms.length > 0 && terms.filter(term => outlineCoverage.includes(term)).length < Math.ceil(terms.length * 0.5);
  });
  const checks: QualityGateCheck[] = [
    { id: "complete-structure", label: "Complete article structure", kind: "deterministic", status: /^#\s+/m.test(draft) && /^##\s+/m.test(draft) ? "pass" : "fail", reason: "Draft must contain one H1 and at least one H2.", autoFixAllowed: true },
    { id: "word-budget", label: "English word target range", kind: "deterministic", status: count >= acceptedMin && count <= acceptedMax ? "pass" : "fail", reason: `${count} English words; target ${wordTarget}, accepted range ${acceptedMin}–${acceptedMax}.`, autoFixAllowed: true },
    { id: "primary-query", label: "Primary query coverage", kind: "deterministic", status: spec?.primaryQuery && body.includes(normalized(spec.primaryQuery)) ? "pass" : "fail", reason: "The primary query must appear naturally in the article.", evidence: spec?.primaryQuery, autoFixAllowed: true },
    { id: "must-cover", label: "Must-cover topics mapped in outline", kind: "deterministic", status: missingCoverage.length ? "fail" : "pass", reason: missingCoverage.length ? `Not mapped in the approved outline: ${missingCoverage.join(", ")}` : "Every required topic is mapped into the approved outline.", autoFixAllowed: true },
    { id: "placeholders", label: "No placeholders", kind: "deterministic", status: /\[(?:cần|needs?|todo|tbd)[^\]]*\]|lorem ipsum|about:blank/i.test(draft) ? "fail" : "pass", reason: "Draft must not contain placeholders or about:blank.", autoFixAllowed: true },
    { id: "source-confidentiality", label: "No internal source leakage", kind: "deterministic", status: leaked.length ? "fail" : "pass", reason: leaked.length ? `Leaked source names: ${leaked.join(", ")}` : "No infrastructure filenames detected.", autoFixAllowed: false },
    { id: "link-correctness", label: "Approved internal links", kind: "deterministic", status: !linkAudit.unapprovedUrls.length && (!linkAudit.required || linkAudit.approvedDraftUrls.length > 0) ? "pass" : "fail", reason: linkAudit.unapprovedUrls.length ? `Not approved in Website Inventory: ${linkAudit.unapprovedUrls.join(", ")}` : linkAudit.required && !linkAudit.approvedDraftUrls.length ? "Article Spec requires an internal link, but the draft does not contain an approved URL." : linkAudit.approvedDraftUrls.length ? "Every internal URL matches an approved Website Inventory entry." : "No internal link is required by the Article Spec.", evidence: linkAudit.internalUrls.join(", "), autoFixAllowed: true },
  ];
  return checks;
}

export function qualityReport(article: Article, checks: QualityGateCheck[]): UniversalQualityReport {
  const status = checks.some(item => item.status === "fail") ? "fail" : checks.some(item => item.status === "warning") ? "warning" : "pass";
  return { version: UNIVERSAL_QUALITY_VERSION, status, checkedAt: new Date().toISOString(), articleSpecFingerprint: article.articleSpec ? articleSpecFingerprint(article.articleSpec) : "missing-spec", checks };
}
