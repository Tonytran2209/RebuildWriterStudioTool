import crypto from "node:crypto"
import { DEFAULT_CONTENT_PLAN_SETTINGS, type ContentPlanSettings } from "../shared/contentPlanSettings.ts"

// v3: the AI only picks which numbered lines are planned articles. Titles are copied from the file,
// and the content group comes from the file's own section headings and title patterns before the
// AI's guess, so changing model changes as little as possible. Bumping the version retires cached v2 answers.
export const CONTENT_PLAN_CLASSIFIER_VERSION = "content-plan-classifier-v3"
// Input per AI call. Output is a few tokens per topic, so CHUNK_MAX_TOKENS is only a safety cap.
export const CHUNK_CHARS = 20_000
export const CHUNK_MAX_TOKENS = 8_000
const LINE_CHARS = 300

export const CLASSIFIER_SYSTEM =
  "You read a Content Plan whose lines are numbered and return which lines are planned articles. Answer with line numbers from the input only."

export function classifierPrompt(numberedText: string, settings: ContentPlanSettings = DEFAULT_CONTENT_PLAN_SETTINGS) {
  return [
    "Each line below starts with its line number and \"|\". Return every line that names ONE article to write.",
    "Include every list of article titles in the document (priority topics, backlogs, action plans, waves, ICP lists): a title listed in two sections is still returned for both lines.",
    "Do NOT return: document titles, section or cluster headings, table headers or cells that describe a cluster, audience, angle, value proposition, signal or criteria, notes, goals, KPIs, dates, owners, statuses, or instructions.",
    // Admin notes refine which lines count; they cannot change the answer format below.
    ...(settings.extraInstructions ? [`Team notes on which lines to return:\n${settings.extraInstructions}`] : []),
    `Group for each line: c = ${settings.comparisonDefinition}; e = ${settings.editorialDefinition}; r = unsure.`,
    'Return JSON only: {"items":[[lineNumber,"c"|"e"|"r"], ...]}',
    numberedText,
  ].join("\n\n")
}

/** The settings that change what the AI is asked; part of the AI cache key, so editing them asks again. */
export const promptSettingsOf = (s: ContentPlanSettings) => ({ c: s.comparisonDefinition, e: s.editorialDefinition, notes: s.extraInstructions })

/** Non-empty lines of a source with their line numbers, as sent to the AI (`n| text`). */
export function numberedLines(text: string, skip: (line: string) => boolean = () => false) {
  return text.replace(/\r\n?/g, "\n").split("\n").flatMap((line, n) =>
    line.trim() && !skip(line) ? [`${n}| ${line.trim().slice(0, LINE_CHARS)}`] : [])
}

/** Split text into chunks of whole lines, each at most `max` characters (a longer single line stays whole). */
export function splitPlanChunks(text: string, max = CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let current = ""
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > max) { chunks.push(current); current = "" }
    current = current ? `${current}\n${line}` : line
  }
  if (current.trim()) chunks.push(current)
  return chunks
}

export const itemsOf = (parsed: any): any[] => Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []

type Group = "comparison-seo" | "editorial-originality" | "needs-review"
const GROUPS: Record<string, Group> = { c: "comparison-seo", e: "editorial-originality", r: "needs-review", "comparison-seo": "comparison-seo", "editorial-originality": "editorial-originality", "needs-review": "needs-review" }

// A numbered or markdown heading ("III. Action Plan Topics", "2. Editorial Support Content", "## Comparison").
const HEADING = /^\s*(?:#{1,6}\s+|(?:\d{1,2}|[IVXLC]{1,6})[.)]\s+)(.+)$/
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// Admin phrases become a plain escaped alternation (no user regex), so matching stays linear.
// "^" first = start of the title, "#" = any number; whole words unless `prefix` (headings match word starts).
function phraseRegex(phrases: string[], prefix = false) {
  const parts = phrases.map(p => {
    const start = p.startsWith("^")
    const body = escape(p.replace(/^\^/, "").trim()).replace(/\s+/g, "\\s+").replace(/#/g, "\\d+")
    return `${start ? "^" : "(?<![\\p{L}\\p{N}])"}${body}${prefix ? "" : "(?![\\p{L}\\p{N}])"}`
  }).filter(Boolean)
  return parts.length ? new RegExp(parts.join("|"), "iu") : null
}
type Rules = { section(heading: string): Group | null; title(title: string): Group | null }
export function compileRules(s: ContentPlanSettings = DEFAULT_CONTENT_PLAN_SETTINGS): Rules {
  const cHead = phraseRegex(s.comparisonHeadings, true), eHead = phraseRegex(s.editorialHeadings, true)
  const cTitle = phraseRegex(s.comparisonPhrases), eTitle = phraseRegex(s.editorialPhrases)
  return {
    section: heading => cHead?.test(heading) ? "comparison-seo" : eHead?.test(heading) ? "editorial-originality" : null,
    // "Why X fails", "X is not Y": a claim to argue, so editorial wins, except a head-to-head "X vs Y".
    title: title => eTitle?.test(title) && !/\b(?:vs\.?|versus)\b/i.test(title) ? "editorial-originality" : cTitle?.test(title) ? "comparison-seo" : null,
  }
}

/**
 * Group set by the closest heading above line `n` (the plan author's own grouping), if it names one.
 * Numbered lines that are themselves topics (`topics`) are not headings.
 */
export function sectionGroupAt(lines: string[], n: number, topics: Set<number> = new Set(), rules: Rules = compileRules()): { group: Group; heading: string } | null {
  for (let i = n - 1; i >= 0; i--) {
    const match = !topics.has(i) && lines[i]?.match(HEADING)
    if (!match) continue
    const group = rules.section(match[1])
    return group ? { group, heading: match[1].trim() } : null
  }
  return null
}

/** Group fixed by the wording of the title, or null when only the AI can tell. */
export function titleGroup(title: string, rules: Rules = compileRules()): Group | null {
  return rules.title(title)
}

/** Article title from a plan line: list markers, markdown marks and table pipes removed. */
export function titleOf(line: string) {
  return line.replace(/^\s*(?:[-*•▪◦]|\d{1,3}[.)]|[a-z][.)])\s+/i, "").replace(/[*_#`]/g, "").replace(/^\|+|\|+$/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Items from the AI's picks ([lineNumber, group]). Titles come from the file; the group is the
 * section heading's, else the title pattern's, else the AI's. Unknown line numbers are dropped.
 */
export function planItemsFromPicks(picks: any[], source: { id: string; extractedContent?: string }, settings: ContentPlanSettings = DEFAULT_CONTENT_PLAN_SETTINGS) {
  const rules = compileRules(settings)
  const unsure: Group = settings.needsReview === "editorial" ? "editorial-originality" : settings.needsReview === "comparison" ? "comparison-seo" : "needs-review"
  const lines = String(source.extractedContent ?? "").replace(/\r\n?/g, "\n").split("\n")
  const dropped: string[] = []
  const lineOf = (pick: any) => Number(Array.isArray(pick) ? pick[0] : pick?.line ?? pick?.n)
  const topics = new Set(picks.map(lineOf).filter(Number.isInteger))
  const seen = new Set<number>()
  const items = picks.flatMap((pick: any) => {
    const n = lineOf(pick)
    // A line picked twice (overlapping retry halves) is one topic; ids are per line.
    if (seen.has(n)) return []
    seen.add(n)
    const line = Number.isInteger(n) ? lines[n] : undefined
    const [rawTitle, rawKeywords = ""] = titleOf(line ?? "").split(/\s+\|\s+/, 2)
    const title = rawTitle.slice(0, 220)
    if (!line?.trim() || !title) { dropped.push(Number.isFinite(n) ? `#${n}` : String(pick)); return [] }
    const section = sectionGroupAt(lines, n, topics, rules)
    const pattern = rules.title(title)
    const aiGroup = GROUPS[String(Array.isArray(pick) ? pick[1] : pick?.group ?? pick?.g ?? "")] ?? "needs-review"
    const type = section?.group ?? pattern ?? (aiGroup === "needs-review" ? unsure : aiGroup)
    return [{
      // Stable per source line, so applying new rules again keeps the links from articles to topics.
      id: `line-${crypto.createHash("sha256").update(`${source.id}|${n}`).digest("hex").slice(0, 20)}`, title,
      keywords: rawKeywords.split(/[,;]+/).map(k => k.trim()).filter(Boolean),
      type, confidence: section ? 1 : pattern ? 0.95 : type === "needs-review" ? 0.5 : 0.8,
      classificationReason: section ? `Section "${section.heading}"` : pattern ? "Title wording" : "AI",
      sourceId: source.id, sourceSectionId: `line-${n}`, sourceLine: line.trim(), sourceQuote: line.trim(),
    }]
  })
  return { items, dropped }
}

const STOP = new Set("a an the and or of to for in on at by with from as is are be do does did it its this that these those when what why how you your vs versus just".split(" "))
const words = (title: string) => new Set(title.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w && !STOP.has(w)))
/** Two titles name the same article: one is a shortened copy of the other, or they share most words. */
const THRESHOLDS = { strict: [0.95, 0.85], normal: [0.85, 0.7], loose: [0.75, 0.6] } as const
export function sameTopic(a: string, b: string, sensitivity: keyof typeof THRESHOLDS = "normal") {
  const x = words(a), y = words(b)
  if (Math.min(x.size, y.size) < 3) return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()
  const shared = [...x].filter(w => y.has(w)).length
  const [contained, overlap] = THRESHOLDS[sensitivity]
  return shared / Math.min(x.size, y.size) >= contained || shared / new Set([...x, ...y]).size >= overlap
}

/**
 * Keep the first item of each topic (its title and position); later copies (same or shortened title)
 * are merged into it. The group comes from the most certain copy: a section heading beats wording beats the AI.
 */
export function mergeDuplicateTopics<T extends { title: string; type?: string; confidence?: number; classificationReason?: string }>(items: T[], settings: ContentPlanSettings = DEFAULT_CONTENT_PLAN_SETTINGS) {
  if (!settings.mergeDuplicates) return items
  const kept: T[] = []
  for (const item of items) {
    const index = kept.findIndex(k => sameTopic(k.title, item.title, settings.duplicateSensitivity))
    if (index < 0) { kept.push(item); continue }
    const first = kept[index]
    if ((item.confidence ?? 0) > (first.confidence ?? 0))
      kept[index] = { ...first, type: item.type, confidence: item.confidence, classificationReason: item.classificationReason }
  }
  return kept
}
