// Admin-editable Content Plan classification (Settings › Workflow AI), stored as config.contentPlan.
// Admins edit the prompt itself; the answer format, line numbering, chunk size, token caps and file limits stay in code.

export type DuplicateSensitivity = "strict" | "normal" | "loose"

export interface ContentPlanSettings {
  /** System prompt of the classification call. */
  systemPrompt: string
  /** The analysis and grouping rules sent before the file's numbered lines. */
  rulesPrompt: string
  /** The closest heading above a topic decides its group when it has one of these words. */
  useHeadings: boolean
  comparisonHeadings: string[]
  editorialHeadings: string[]
  /** Words in a title decide its group. "^" first = the title starts with it; "#" = any number; "*" = any letters. */
  useTitleWords: boolean
  comparisonPhrases: string[]
  editorialPhrases: string[]
  mergeDuplicates: boolean
  duplicateSensitivity: DuplicateSensitivity
  /** On: topics the AI is unsure about stay "Needs review" (run as Editorial in a batch). Off: they become Editorial. */
  keepNeedsReview: boolean
}

export const DEFAULT_SYSTEM_PROMPT =
  "You read a Content Plan whose lines are numbered and return which lines are planned articles. Answer with line numbers from the input only."

export const DEFAULT_RULES_PROMPT = [
  "Each line below starts with its line number and \"|\". Return every line that names ONE article to write.",
  "Include every list of article titles in the document (priority topics, backlogs, action plans, waves, ICP lists): a title listed in two sections is still returned for both lines.",
  "Do NOT return: document titles, section or cluster headings, table headers or cells that describe a cluster, audience, angle, value proposition, signal or criteria, notes, goals, KPIs, dates, owners, statuses, or instructions.",
  "Group for each line: c = comparison or commercial SEO (X vs Y, alternatives, best/top, reviews, pricing, buyer guides, templates, how to choose/evaluate); e = editorial (why something fails, myths, analysis, opinion, insight); r = unsure.",
].join("\n\n")

/** Always added by the tool after the rules, so the answer can be read whatever the rules say. */
export const CLASSIFIER_ANSWER_FORMAT = 'Return JSON only: {"items":[[lineNumber,"c"|"e"|"r"], ...]} where lineNumber is a number from the input, c = Comparison, e = Editorial, r = unsure.'

export const DEFAULT_CONTENT_PLAN_SETTINGS: ContentPlanSettings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  rulesPrompt: DEFAULT_RULES_PROMPT,
  useHeadings: true,
  comparisonHeadings: ["compar*", "so sánh", "vs", "versus"],
  editorialHeadings: ["editorial*", "thought leadership", "góc nhìn"],
  useTitleWords: true,
  comparisonPhrases: ["vs", "vs.", "versus", "alternative", "alternatives", "instead of", "different from", "compared to", "compared with", "template", "checklist", "pricing", "how to price", "how to choose", "how to evaluate", "how to pick", "what to look for", "^best", "^top #"],
  editorialPhrases: ["^why", "not", "cannot", "can't", "fail", "fails", "myth", "myths"],
  mergeDuplicates: true,
  duplicateSensitivity: "normal",
  keepNeedsReview: true,
}

export const CONTENT_PLAN_LIMITS = { listItems: 40, phraseChars: 60, systemChars: 2000, rulesChars: 8000 }

const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max)
const text = (value: unknown, max: number, fallback: string) => String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, max) || fallback
const flag = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback
function list(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const seen = new Set<string>()
  return value.map(v => clean(v, CONTENT_PLAN_LIMITS.phraseChars).toLocaleLowerCase())
    .filter(v => v.replace(/[\^#*\s]/g, "") && !seen.has(v) && seen.add(v))
    .slice(0, CONTENT_PLAN_LIMITS.listItems)
}

/** Settings as saved by an admin, made safe: unknown fields dropped, lengths capped, missing or empty fields defaulted. */
export function normalizeContentPlanSettings(input: unknown): ContentPlanSettings {
  const s: any = input && typeof input === "object" ? input : {}
  const d = DEFAULT_CONTENT_PLAN_SETTINGS, L = CONTENT_PLAN_LIMITS
  return {
    systemPrompt: text(s.systemPrompt, L.systemChars, d.systemPrompt),
    rulesPrompt: text(s.rulesPrompt, L.rulesChars, d.rulesPrompt),
    useHeadings: flag(s.useHeadings, d.useHeadings),
    comparisonHeadings: list(s.comparisonHeadings, d.comparisonHeadings),
    editorialHeadings: list(s.editorialHeadings, d.editorialHeadings),
    useTitleWords: flag(s.useTitleWords, d.useTitleWords),
    comparisonPhrases: list(s.comparisonPhrases, d.comparisonPhrases),
    editorialPhrases: list(s.editorialPhrases, d.editorialPhrases),
    mergeDuplicates: flag(s.mergeDuplicates, d.mergeDuplicates),
    duplicateSensitivity: (["strict", "normal", "loose"] as const).includes(s.duplicateSensitivity) ? s.duplicateSensitivity : d.duplicateSensitivity,
    keepNeedsReview: flag(s.keepNeedsReview, d.keepNeedsReview),
  }
}
