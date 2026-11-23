import crypto from "node:crypto"

// v2: one item per planned article row, titles kept verbatim, plans split into chunks. Bumping the
// version also retires cached v1 answers, which were model-dependent.
export const CONTENT_PLAN_CLASSIFIER_VERSION = "content-plan-classifier-v2"
// Input per AI call. About 20k characters of plan rows fits well inside CHUNK_MAX_TOKENS of output.
export const CHUNK_CHARS = 20_000
export const CHUNK_MAX_TOKENS = 12_000

export const CLASSIFIER_SYSTEM =
  "You extract planned articles from a Content Plan and classify each one. Only use rows explicitly present in the source. Never invent, merge, split, rewrite or translate topics. Every item must copy its title and sourceQuote verbatim from the source."

export function classifierPrompt(text: string) {
  return [
    "Extract every planned article in the SOURCE below. Rows with an explicit content-group label were already handled and are not included.",
    "What counts as one item:",
    "- One item per row, line, bullet or table row that names one article to write.",
    "- NOT items: section or cluster headings, pillar names, column headers, notes, goals, KPIs, dates, owners, statuses, word counts, keyword-only rows, instructions.",
    "- When a heading groups several articles, the articles are the items, not the heading.",
    "- title: the article title exactly as written in its row (same language, same wording). sourceQuote: the exact text of that title in the source.",
    "- keywords: only keywords written in that same row; otherwise [].",
    "How to classify:",
    "- comparison-seo: comparisons, versus, alternatives, reviews, best/top lists, pricing, buyer guides, commercial or transactional SEO intent.",
    "- editorial-originality: thought leadership, analysis, opinion, original research, storytelling, brand editorial, or expert insight.",
    "- needs-review: when confidence is below 0.65 or the row is ambiguous.",
    'Return JSON only: {"items":[{"title":string,"keywords":string[],"contentGroup":"comparison-seo"|"editorial-originality"|"needs-review","confidence":number,"classificationReason":string,"sourceLine":string,"sourceQuote":string}]}',
    `SOURCE\n${text}`,
  ].join("\n\n")
}

/** Split plan text into chunks of whole lines, each at most `max` characters (a longer single line stays whole). */
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

// Extraction (DOCX tables, PDF) and models disagree on quotes, dashes, markdown marks and spacing.
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase()
  .replace(/[“”«»„]/g, '"').replace(/[‘’`]/g, "'").replace(/[–—]/g, "-").replace(/[*_#]/g, "")
  .replace(/\s+/g, " ").trim()

export function quoteInSource(source: string, quote: string) {
  const q = normalize(quote)
  return q.length > 0 && normalize(source).includes(q)
}

/**
 * Keep AI items whose title or quote is found in their source; report the rest as dropped.
 * Raw items carry `sourceId` (set by the caller per chunk, or by the model for older answers).
 */
export function verifiedClassificationItems(rawItems: any[], plan: any) {
  const sources = new Map<string, any>((plan.sources ?? []).map((source: any) => [source.id, source]))
  const seen = new Set<string>()
  const dropped: string[] = []
  const items = rawItems.flatMap((raw: any, index: number) => {
    const source = sources.get(String(raw?.sourceId ?? "")) ?? (sources.size === 1 ? [...sources.values()][0] : null)
    const title = String(raw?.title ?? "").trim()
    if (!title) return []
    const content = String(source?.extractedContent ?? "")
    let quote = String(raw.sourceQuote ?? "").trim()
    if (!quote || !quoteInSource(content, quote)) quote = quoteInSource(content, title) ? title : ""
    if (!source || !quote) { dropped.push(title); return [] }
    const key = title.toLocaleLowerCase()
    if (seen.has(key)) return []
    seen.add(key)
    const group = String(raw.contentGroup ?? raw.type ?? "").replaceAll("_", "-")
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0)))
    return [{
      id: crypto.randomUUID(),
      title,
      keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean) : [],
      type: ["comparison-seo", "editorial-originality"].includes(group) && confidence >= 0.65 ? group : "needs-review",
      sourceLine: String(raw.sourceLine ?? quote),
      confidence,
      classificationReason: String(raw.classificationReason ?? "").trim(),
      sourceId: source.id,
      sourceSectionId: String(raw.sourceSectionId ?? `item-${index + 1}`),
      sourceQuote: quote,
    }]
  })
  return { items, dropped }
}

export const itemsOf = (parsed: any): any[] => Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
