import type { QualityGateCheck } from '../types/index.ts';

export function internalLinkBudget(wordTarget: number) {
  if (wordTarget < 1000) return { target: 3, max: 4 };
  if (wordTarget < 1300) return { target: 4, max: 5 };
  if (wordTarget <= 1700) return { target: 5, max: 7 };
  if (wordTarget <= 2100) return { target: 6, max: 8 };
  return { target: 7, max: 9 };
}
export function canonicalInternalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = ''; url.search = ''; url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch { return value.trim(); }
}
function urls(text: string) {
  return [...text.matchAll(/https?:\/\/[^\s)\]}>"']+/gi)].map(match => canonicalInternalUrl(match[0].replace(/[.,;:!?]+$/, '')));
}
export function internalLinkInstruction(wordTarget: number, candidateCount: number) {
  const budget = internalLinkBudget(wordTarget);
  return `INTERNAL LINK CONTRACT: For the ${wordTarget}-word target, include ${budget.target}–${budget.max} distinct contextual internal links using only approved Website Inventory URLs. Spread links across relevant H2/H3 body sections, no more than one internal link per section; do not cluster them in the conclusion. Use natural descriptive anchors. Never invent or alter a URL, and repeated/canonical-equivalent URLs count only once. ${candidateCount < budget.target ? `Only ${candidateCount} approved candidate URLs are available: use suitable approved URLs only; do not fabricate links to fill the shortage. QC must report any remaining shortfall.` : ''}`;
}
export function internalLinkChecks(draft: string, approvedValues: Iterable<string>, wordTarget: number): QualityGateCheck[] {
  const approved = new Set([...approvedValues].map(canonicalInternalUrl));
  const unique = [...new Set(urls(draft).filter(url => approved.has(url)))];
  const budget = internalLinkBudget(wordTarget);
  const headings = [...draft.matchAll(/^#{2,3}\s+(.+)$/gm)];
  const overloaded = headings.filter((heading, index) => urls(draft.slice((heading.index ?? 0) + heading[0].length, headings[index + 1]?.index ?? draft.length)).filter(url => approved.has(url)).length > 1);
  return [
    { id: 'internal-link-budget', label: 'Internal link budget', kind: 'deterministic', status: unique.length >= budget.target && unique.length <= budget.max ? 'pass' : 'fail', reason: `${unique.length} unique approved internal links; require ${budget.target}–${budget.max} for the ${wordTarget}-word target.`, evidence: unique.join(', '), recommendedAction: 'Use distinct approved Website Inventory pages. Approve more relevant pages if inventory is insufficient; never fabricate URLs.', autoFixAllowed: true },
    { id: 'internal-link-distribution', label: 'Internal links distributed across sections', kind: 'deterministic', status: overloaded.length ? 'fail' : 'pass', reason: overloaded.length ? `Sections contain more than one internal link: ${overloaded.map(item => item[1]).join(', ')}.` : 'No section contains more than one approved internal link.', autoFixAllowed: true },
  ];
}

type Candidate = { url: string; title: string; suggestedAnchors?: string[] };
export function addMissingInternalLinks(draft: string, candidates: Candidate[], approvedValues: Iterable<string>, wordTarget: number) {
  const approved = new Set([...approvedValues].map(canonicalInternalUrl));
  const used = new Set(urls(draft).filter(url => approved.has(url)));
  const needed = Math.max(0, internalLinkBudget(wordTarget).target - used.size);
  const available = candidates.filter((item, index, all) => approved.has(canonicalInternalUrl(item.url)) && !used.has(canonicalInternalUrl(item.url)) && all.findIndex(other => canonicalInternalUrl(other.url) === canonicalInternalUrl(item.url)) === index).slice(0, needed);
  const headings = [...draft.matchAll(/^#{2,3}\s+(.+)$/gm)];
  const empty = headings.flatMap((heading, index) => {
    const end = headings[index + 1]?.index ?? draft.length;
    const body = draft.slice((heading.index ?? 0) + heading[0].length, end);
    return !/^conclusion$/i.test(heading[1].trim()) && !urls(body).some(url => approved.has(url)) ? [{ end }] : [];
  });
  const edits = available.slice(0, empty.length).map((item, index) => {
    const anchor = (item.suggestedAnchors?.[0] || item.title).replace(/[\[\]]/g, '');
    return { end: empty[index].end, text: `For related guidance on ${anchor}, see [${anchor}](${item.url}).` };
  }).sort((a, b) => b.end - a.end);
  let result = draft;
  for (const edit of edits) result = `${result.slice(0, edit.end).trimEnd()}\n\n${edit.text}\n\n${result.slice(edit.end).trimStart()}`.trim();
  return result;
}
