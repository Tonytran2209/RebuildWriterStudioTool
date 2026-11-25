export type IntroductionBudget = { min: number; max: number };
/** Default when no Gate Playbook sets introMinWords/introMaxWords. */
export const INTRODUCTION_BUDGET = { min: 60, max: 85, acceptedMin: 60, acceptedMax: 85 };
export const introductionBudget = (b?: Partial<IntroductionBudget> | null) => {
  const min = Number(b?.min) || INTRODUCTION_BUDGET.min, max = Math.max(min, Number(b?.max) || INTRODUCTION_BUDGET.max);
  return { min, max, acceptedMin: min, acceptedMax: max };
};
export function introductionInstruction(budget?: Partial<IntroductionBudget> | null) {
  const b = introductionBudget(budget);
  // The line hint matches only the default 60–85 words; a Playbook budget drops it.
  const lines = b.min === INTRODUCTION_BUDGET.min && b.max === INTRODUCTION_BUDGET.max ? 'approximately 5–6' : 'a compact number of';
  return `INTRODUCTION CONTRACT (overrides percentage budgets and legacy introduction rules): Write one compact paragraph of ${b.min}–${b.max} English words, ideally 3–4 concise sentences, aiming for ${lines} desktop reading lines. Do not insert manual line breaks to manufacture a line count. Start with the reader’s specific pain point, decision or desired outcome and answer the primary search intent immediately. Then offer a concrete useful insight and explain what the reader will gain. Avoid generic scene-setting, repeated titles, rhetorical filler, clickbait and unsupported promises. Do not expand the introduction to meet the overall article word target; allocate additional words to body sections. Evaluate content quality separately from responsive screen line count.`;
}
export const INTRODUCTION_INSTRUCTION = introductionInstruction();

export function introductionCheck(draft: string, budget?: Partial<IntroductionBudget> | null) {
  const b = introductionBudget(budget);
  const text = draft.replace(/\r\n?/g, '\n');
  const title = /^\s*#\s+[^\n]+\n*/.exec(text);
  const afterTitle = text.slice(title?.[0].length ?? 0);
  const heading = afterTitle.search(/^#{2,6}\s+/m);
  const introduction = afterTitle.slice(0, heading < 0 ? afterTitle.length : heading).trim();
  const prose = introduction.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '');
  const words = prose.split(/\s+/).filter(Boolean).length;
  const paragraphs = introduction ? introduction.split(/\n\s*\n/).filter(part => part.trim()).length : 0;
  const pass = words >= b.min && words <= b.max && paragraphs === 1;
  return {
    id: 'introduction-word-budget', label: 'Concise reader-focused introduction', kind: 'deterministic' as const,
    status: pass ? 'pass' as const : 'fail' as const,
    reason: `${words} words, ${paragraphs} paragraphs; require ${b.min}–${b.max} English words in one paragraph.`,
    recommendedAction: introductionInstruction(b), autoFixAllowed: true,
  };
}

export const INTRODUCTION_REVIEW_CONTRACT = 'Treat the deterministic introduction measurement as authoritative for length and paragraph count. Do not estimate word count or fail intro-quality for length when the measurement passes. For intro-quality, evaluate the reader pain point, immediate answer, practical insight and reader benefit.';

export function introductionReviewInstruction(draft: string, budget?: Partial<IntroductionBudget> | null) {
  const check = introductionCheck(draft, budget);
  return `DETERMINISTIC INTRODUCTION MEASUREMENT: ${check.status.toUpperCase()}. ${check.reason}\n${INTRODUCTION_REVIEW_CONTRACT}`;
}
