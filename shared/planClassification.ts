export const PLAN_CLASSIFICATION_DEFAULTS = {
  splitByWave: false,
  recognizeLabels: true,
  confidenceThreshold: 0.65,
  systemPrompt: "Classify only topics explicitly present in the supplied Content Plan sources. Never invent topics. Every item must include a verbatim sourceQuote copied from its source.",
  extractionPrompt: "Extract and classify every planned article in the supplied Content Plan. Section headings (for example \"Comparison Content\" or an audience list) describe the topics listed under them: include every topic in every section.",
  comparisonRule: "comparisons, versus, alternatives, reviews, best/top lists, pricing, buyer guides, commercial or transactional SEO intent.",
  editorialRule: "thought leadership, analysis, opinion, original research, storytelling, brand editorial, or expert insight.",
  resultPrompt: "",
};
export type PlanClassificationSettings = typeof PLAN_CLASSIFICATION_DEFAULTS;

export function planClassificationSettings(saved?: Partial<PlanClassificationSettings> | null): PlanClassificationSettings {
  const defaults = PLAN_CLASSIFICATION_DEFAULTS;
  const instruction = (value: unknown, fallback: string) => typeof value === "string" ? value.trim().slice(0, 8000) || fallback : fallback;
  const threshold = saved?.confidenceThreshold;
  return {
    splitByWave: saved?.splitByWave === true,
    recognizeLabels: saved?.recognizeLabels !== false,
    confidenceThreshold: typeof threshold === "number" && Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : defaults.confidenceThreshold,
    systemPrompt: instruction(saved?.systemPrompt, defaults.systemPrompt),
    extractionPrompt: instruction(saved?.extractionPrompt, defaults.extractionPrompt),
    comparisonRule: instruction(saved?.comparisonRule, defaults.comparisonRule),
    editorialRule: instruction(saved?.editorialRule, defaults.editorialRule),
    resultPrompt: instruction(saved?.resultPrompt, defaults.resultPrompt),
  };
}
