// Allow room for prose, JSON structure and reasoning tokens in the output budget.
export function structuredDraftTokenBudget(words: number, recovery = false) {
  const proseBudget = Math.max(8000, Math.ceil(words * 4) + 2000);
  return Math.min(24000, recovery ? proseBudget + 4000 : proseBudget);
}

export function assertStructuredDraftFields(parsed: any) {
  const missing: string[] = [];
  for (const field of ['title', 'introduction', 'conclusion']) {
    if (typeof parsed?.[field] !== 'string' || !parsed[field].trim()) missing.push(field);
  }
  if (!Array.isArray(parsed?.sections) || !parsed.sections.length) missing.push('sections');
  if (missing.length) throw new Error(`Structured draft has missing or invalid fields: ${missing.join(', ')}.`);
}

export function isCompleteStructuredDraft(raw: string) {
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    assertStructuredDraftFields(parsed);
    return parsed.sections.every((section: any) =>
      typeof section?.id === 'string' && section.id.trim() &&
      typeof section?.content === 'string' && section.content.trim() &&
      Array.isArray(section.usedEvidenceRefs));
  } catch {
    return false;
  }
}
