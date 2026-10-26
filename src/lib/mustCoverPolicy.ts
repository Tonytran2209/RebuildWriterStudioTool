import type { OutlineSection } from '../types/index.ts';

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function terms(value: string) {
  return normalized(value).split(' ').filter(term => term.length > 3);
}

function covers(text: string, topic: string) {
  const haystack = normalized(text);
  const relevant = terms(topic);
  return relevant.length > 0 && relevant.filter(term => haystack.includes(term)).length >= Math.ceil(relevant.length / 2);
}

export function missingMustCoverTopics(outline: OutlineSection[], mustCover: string[], draft = '') {
  const outlineText = outline.flatMap(section => [section.heading, section.notes, section.rationale, ...(section.keywords ?? [])]).filter(Boolean).join(' ');
  return mustCover.filter(topic => !covers(outlineText, topic) && !covers(draft, topic));
}

// Persist the spec requirement in the most relevant section's editorial notes.
// This makes future drafts aware of it, while draft QC still checks the prose.
export function mapMustCoverTopics(outline: OutlineSection[], mustCover: string[]) {
  const next = outline.map(section => ({ ...section }));
  for (const topic of missingMustCoverTopics(next, mustCover)) {
    const topicTerms = new Set(terms(topic));
    const best = next.map((section, index) => ({ index, score: terms([section.heading, section.notes, section.rationale, ...(section.keywords ?? [])].filter(Boolean).join(' ')).filter(term => topicTerms.has(term)).length }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0];
    if (!best) continue;
    const section = next[best.index];
    section.notes = [section.notes?.trim(), `Required coverage: ${topic}.`].filter(Boolean).join(' ');
  }
  return next;
}
