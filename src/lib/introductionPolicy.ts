export const INTRODUCTION_BUDGET = { min: 60, max: 85, acceptedMin: 60, acceptedMax: 85 };
export const INTRODUCTION_INSTRUCTION = 'INTRODUCTION CONTRACT (overrides percentage budgets and legacy introduction rules): Write one compact paragraph of 60–85 English words, ideally 3–4 concise sentences, aiming for approximately 5–6 desktop reading lines. Do not insert manual line breaks to manufacture a line count. Start with the reader’s specific pain point, decision or desired outcome and answer the primary search intent immediately. Then offer a concrete useful insight and explain what the reader will gain. Avoid generic scene-setting, repeated titles, rhetorical filler, clickbait and unsupported promises. Do not expand the introduction to meet the overall article word target; allocate additional words to body sections. Evaluate content quality separately from responsive screen line count.';

export function introductionCheck(draft: string) {
  const text = draft.replace(/\r\n?/g, '\n');
  const title = /^\s*#\s+[^\n]+\n*/.exec(text);
  const afterTitle = text.slice(title?.[0].length ?? 0);
  const heading = afterTitle.search(/^#{2,6}\s+/m);
  const introduction = afterTitle.slice(0, heading < 0 ? afterTitle.length : heading).trim();
  const prose = introduction.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '');
  const words = prose.split(/\s+/).filter(Boolean).length;
  const paragraphs = introduction ? introduction.split(/\n\s*\n/).filter(part => part.trim()).length : 0;
  const pass = words >= INTRODUCTION_BUDGET.min && words <= INTRODUCTION_BUDGET.max && paragraphs === 1;
  return {
    id: 'introduction-word-budget', label: 'Concise reader-focused introduction', kind: 'deterministic' as const,
    status: pass ? 'pass' as const : 'fail' as const,
    reason: `${words} words, ${paragraphs} paragraphs; require 60–85 English words in one paragraph, aiming for 5–6 desktop lines.`,
    recommendedAction: INTRODUCTION_INSTRUCTION, autoFixAllowed: true,
  };
}
