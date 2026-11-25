// Admin-editable rules of the Content Plan classifier (Settings › Workflow AI), stored as config.contentPlan.
// The line-number protocol, chunk size, token caps and file limits stay in code.

export type DuplicateSensitivity = "strict" | "normal" | "loose"
export type NeedsReviewMode = "keep" | "editorial" | "comparison"

export interface ContentPlanSettings {
  /** A heading with one of these words puts the topics under it in the group (same syntax as phrases). */
  comparisonHeadings: string[]
  editorialHeadings: string[]
  /** Whole-word phrases in a title. "^" first = the title starts with it; "#" = any number; "*" = any letters. */
  comparisonPhrases: string[]
  editorialPhrases: string[]
  /** How the AI is told what each group means, for topics no heading or phrase decides. */
  comparisonDefinition: string
  editorialDefinition: string
  /** Extra notes for the AI on which lines are topics. */
  extraInstructions: string
  mergeDuplicates: boolean
  duplicateSensitivity: DuplicateSensitivity
  /** What a topic the AI is unsure about becomes. "keep" = Needs review (runs as Editorial in a batch). */
  needsReview: NeedsReviewMode
  /** Paid AI calls per plan per day. */
  dailyAiLimit: number
}

export const DEFAULT_CONTENT_PLAN_SETTINGS: ContentPlanSettings = {
  comparisonHeadings: ["compar*", "so sánh", "vs", "versus"],
  editorialHeadings: ["editorial*", "thought leadership", "góc nhìn"],
  comparisonPhrases: ["vs", "vs.", "versus", "alternative", "alternatives", "instead of", "different from", "compared to", "compared with", "template", "checklist", "pricing", "how to price", "how to choose", "how to evaluate", "how to pick", "what to look for", "^best", "^top #"],
  editorialPhrases: ["^why", "not", "cannot", "can't", "fail", "fails", "myth", "myths"],
  comparisonDefinition: "comparison or commercial SEO (X vs Y, alternatives, best/top, reviews, pricing, buyer guides, templates, how to choose/evaluate)",
  editorialDefinition: "editorial (why something fails, myths, analysis, opinion, insight)",
  extraInstructions: "",
  mergeDuplicates: true,
  duplicateSensitivity: "normal",
  needsReview: "keep",
  dailyAiLimit: 12,
}

export const CONTENT_PLAN_LIMITS = { listItems: 40, phraseChars: 60, definitionChars: 300, instructionChars: 1000, minDaily: 1, maxDaily: 100 }

const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
function list(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const seen = new Set<string>()
  return value.map(v => clean(v, CONTENT_PLAN_LIMITS.phraseChars).toLocaleLowerCase())
    .filter(v => v.replace(/[\^#*\s]/g, "") && !seen.has(v) && seen.add(v))
    .slice(0, CONTENT_PLAN_LIMITS.listItems)
}
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T) => options.includes(value as T) ? value as T : fallback

/** Settings as saved by an admin, made safe: unknown fields dropped, lengths capped, missing fields defaulted. */
export function normalizeContentPlanSettings(input: unknown): ContentPlanSettings {
  const s: any = input && typeof input === "object" ? input : {}
  const d = DEFAULT_CONTENT_PLAN_SETTINGS, L = CONTENT_PLAN_LIMITS
  const daily = Math.round(Number(s.dailyAiLimit))
  return {
    comparisonHeadings: list(s.comparisonHeadings, d.comparisonHeadings),
    editorialHeadings: list(s.editorialHeadings, d.editorialHeadings),
    comparisonPhrases: list(s.comparisonPhrases, d.comparisonPhrases),
    editorialPhrases: list(s.editorialPhrases, d.editorialPhrases),
    comparisonDefinition: clean(s.comparisonDefinition, L.definitionChars) || d.comparisonDefinition,
    editorialDefinition: clean(s.editorialDefinition, L.definitionChars) || d.editorialDefinition,
    extraInstructions: String(s.extraInstructions ?? "").trim().slice(0, L.instructionChars),
    mergeDuplicates: typeof s.mergeDuplicates === "boolean" ? s.mergeDuplicates : d.mergeDuplicates,
    duplicateSensitivity: oneOf(s.duplicateSensitivity, ["strict", "normal", "loose"] as const, d.duplicateSensitivity),
    needsReview: oneOf(s.needsReview, ["keep", "editorial", "comparison"] as const, d.needsReview),
    dailyAiLimit: Number.isFinite(daily) ? Math.min(L.maxDaily, Math.max(L.minDaily, daily)) : d.dailyAiLimit,
  }
}
