import type { EvidenceRef } from '../types/index.ts';

export function isClaimEvidence(item: EvidenceRef): boolean {
  const quote = item.quote ?? '';
  return item.role === 'kb' && quote.trim().split(/\s+/).length >= 8 && !/^\s*#{1,6}\s/.test(quote);
}
export function hasRequiredEvidence(evidence: EvidenceRef[], knowledgeAvailable: boolean, rulesAvailable: boolean) {
  return (!knowledgeAvailable || evidence.some(isClaimEvidence)) && (!rulesAvailable || evidence.some(item => item.role === 'rules'));
}
export function quoteSupportedBySource(content: string, quote: string) {
  const canonical = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\u00ad/g, '').replace(/[“”„‟]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const source = canonical(content);
  const target = canonical(quote);
  if (!target) return false;
  if (source.includes(target)) return true;
  const parts = quote.split(/\r?\n|\.{3}|…|(?<=[.!?。])\s+/).map(canonical).filter(Boolean);
  return parts.some(part => part.length >= 24) && parts.every(part => source.includes(part));
}
const stop = new Set('about after before between content design evidence guide introduction section should their there these those through using which where with without practical comparison differences similarities article'.split(' '));
function terms(value: string) {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])].filter(term => !stop.has(term));
}
export function sectionEvidence(candidates: EvidenceRef[], query: string, limit = 3): EvidenceRef[] {
  const keywords = terms(query);
  return candidates.filter(isClaimEvidence).map(item => ({ item, score: keywords.filter(term => (item.quote ?? '').toLocaleLowerCase().includes(term)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score)
    .filter((item, index, all) => all.findIndex(other => other.item.source === item.item.source && other.item.quote === item.item.quote) === index)
    .slice(0, limit).map(({ item }) => item);
}
export function knowledgeExcerpts(documents: Array<{ name: string; content?: string }>): EvidenceRef[] {
  return documents.flatMap(doc => (doc.content ?? '').split(/\n\s*\n|\r?\n/).flatMap(paragraph => {
    const text = paragraph.trim();
    // Bounded excerpts, retaining exact source text for deterministic verification.
    const quote = text.length <= 1200 ? text : text.slice(0, text.lastIndexOf(' ', 1200) > 0 ? text.lastIndexOf(' ', 1200) : 1200);
    const item: EvidenceRef = { source: doc.name, role: 'kb', quote, note: 'Retrieved from the authorized KB for this section; semantic support still requires review.' };
    return isClaimEvidence(item) ? [item] : [];
  }));
}

export function declaredEvidenceUsage(sections: Array<{ id: string; evidenceRefs?: string[] }>, usage: Record<string, string[]>) {
  return Object.fromEntries(sections.map(section => {
    const allowed = new Set(section.evidenceRefs ?? []);
    return [section.id, [...new Set((Array.isArray(usage[section.id]) ? usage[section.id] : []).map(String).filter(id => allowed.has(id)))]];
  }));
}

export function remapEvidenceUsage(oldRegistry: Record<string, EvidenceRef>, sections: Array<{ id: string; evidenceRefs?: string[] }>, newRegistry: Record<string, EvidenceRef>, usage: Record<string, string[]>) {
  return Object.fromEntries(sections.map(section => [section.id, [...new Set((usage[section.id] ?? []).flatMap(id => {
    const old = oldRegistry[id];
    if (!old) return [];
    return (section.evidenceRefs ?? []).filter(ref => {
      const fresh = newRegistry[ref];
      return fresh && fresh.source === old.source && fresh.quote === old.quote && fresh.role === old.role;
    });
  }))]]));
}
