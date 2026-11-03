import type { Article, QualityGateCheck } from '../types/index.ts';
import { outlineStructurePrompt, validateOutlineStructure } from '../../shared/outlineStructures.ts';

export function outlineReviewInstruction(article: Partial<Article>): string {
  if (!article.outlineStructure) return 'Evaluate the approved outline and Article Spec; no selected MD structure is recorded. Do not assume a generic comparison format.';
  return [
    'OUTLINE STRUCTURE REVIEW CONTRACT:',
    outlineStructurePrompt(article.outlineStructure, 'draft'),
    `APPROVED HEADING HIERARCHY: ${JSON.stringify((article.outline ?? []).map(({ heading, level }) => ({ heading, level })))}`,
    'Within reader-outcome, assess the argument sequence and reader guidance against this selected form. Do not demand sections or comparison devices belonging to another form. Narrative, Q&A, pattern and myth-busting layouts are not automatically comparison articles.',
    'An outline structure governs the body, not the introduction budget. The shared introduction contract still wins: one paragraph, 60–85 English words. Desktop line count is a reading target, never a responsive pixel-level pass/fail rule.',
    'Use actual supported content to assess applicability. Do not invent cases, evidence, headings or an H3 quota. For a material structure violation, identify the section, violated MD instruction and a specific correction; advisory preferences must not block completion.',
  ].join('\n');
}
export function outlineQualityChecks(article: Partial<Article>, draft: string): QualityGateCheck[] {
  if (!article.outlineStructure) return [];
  const errors = validateOutlineStructure(article.outline ?? [], article.outlineStructure);
  let hasParent = false;
  for (const section of article.outline ?? []) {
    if (section.level === "h2") hasParent = true;
    else if (!hasParent) errors.push(`H3 needs a preceding H2 parent: ${section.heading}`);
  }
  const normalize = (s: string) => s.replace(/[*_`]/g, '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const headings = [...draft.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').matchAll(/^(#{2,3})\s+(.+?)\s*#*\s*$/gm)].map(match => ({ heading: match[2], level: match[1].length === 3 ? 'h3' : 'h2' }));
  let cursor = 0;
  const fidelity: string[] = [];
  for (const expected of article.outline ?? []) {
    const offset = headings.slice(cursor).findIndex(h => normalize(h.heading) === normalize(expected.heading) && h.level === expected.level);
    if (offset < 0) fidelity.push(`Missing, reordered or wrong level: ${expected.level.toUpperCase()} ${expected.heading}`);
    else cursor += offset + 1;
  }
  const approved = new Set((article.outline ?? []).map(s => `${s.level}:${normalize(s.heading)}`));
  for (const h of headings) if (!approved.has(`${h.level}:${normalize(h.heading)}`) && !(h.level === 'h2' && normalize(h.heading) === 'conclusion')) fidelity.push(`Unplanned heading: ${h.heading}`);
  return [
    { id: 'outline-structure', label: 'Selected MD structure requirements', kind: 'deterministic', status: errors.length ? 'fail' : 'pass', reason: errors.join('; ') || `Approved outline satisfies explicit required headings for ${article.outlineStructure.name}. Narrative layout is evaluated in reader-outcome.`, recommendedAction: errors.length ? 'Correct or regenerate the outline for the selected MD structure before rewriting the draft.' : undefined, autoFixAllowed: false },
    { id: 'outline-fidelity', label: 'Draft follows approved heading hierarchy', kind: 'deterministic', status: fidelity.length ? 'fail' : 'pass', reason: fidelity.join('; ') || 'Draft preserves approved headings, levels and order.', recommendedAction: fidelity.length ? 'Restore the approved heading hierarchy; preserve the selected structure and supported prose.' : undefined, autoFixAllowed: true },
  ];
}
