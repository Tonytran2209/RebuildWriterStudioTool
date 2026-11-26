/** G1/G2 self-review: response schemas and how a fix is applied to the article (no I/O, unit-tested). */
import { canonicalSpecFingerprint } from "../src/lib/qualityPolicy.ts"
import { validateOutlineStructure } from "../shared/outlineStructures.ts"

/** mustCover holds reader-facing topics only, never writing instructions. */
export function sanitizeBatchArticleSpec(spec: any) {
  const instructionPattern = /\b(exact primary keyword|title|introduction|heading|body copy|conclusion|keyword density|use the exact|include the keyword)\b/i
  const mustCover = (Array.isArray(spec?.mustCover) ? spec.mustCover : [])
    .map(String)
    .map((item: string) => item.trim())
    .filter((item: string) => item && !instructionPattern.test(item))
  return { ...spec, mustCover }
}

const stringArray = { type: "array", items: { type: "string" } }
// G1/G2 self-review (Settings › Workflow rules): one entry per applicable Standards item.
export const gateReviewJsonSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["checks"],
  properties: { checks: { type: "array", items: { type: "object", additionalProperties: false, required: ["item", "status", "reason", "location", "fixable"], properties: {
    item: { type: "string" }, status: { type: "string", enum: ["pass", "warning", "fail"] }, reason: { type: "string" }, location: { type: "string" }, fixable: { type: "boolean" },
  } } } },
}
// A G1 fix may change only the wording of the selected idea and the Spec's reader-facing fields.
export const specFixJsonSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["idea", "articleSpec"],
  properties: {
    idea: { type: "object", additionalProperties: false, required: ["title", "angleLabel", "angleDescription", "mainArgument", "targetAudience", "recommendedTone"], properties: { title: { type: "string" }, angleLabel: { type: "string" }, angleDescription: { type: "string" }, mainArgument: { type: "string" }, targetAudience: { type: "string" }, recommendedTone: { type: "string" } } },
    articleSpec: { type: "object", additionalProperties: false, required: ["thesis", "brandPov", "expectedReaderOutcome", "mustCover", "optionalCoverage", "ctaObjective"], properties: { thesis: { type: "string" }, brandPov: { type: "string" }, expectedReaderOutcome: { type: "string" }, mustCover: stringArray, optionalCoverage: stringArray, ctaObjective: { type: "string" } } },
  },
}
// A G2 fix keeps every section ID, level and order; only wording fields change.
export const outlineFixJsonSchema: Record<string, unknown> = {
  type: "object", additionalProperties: false, required: ["sections"],
  properties: { sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "heading", "notes", "keywords", "searchIntent", "rationale"], properties: { id: { type: "string" }, heading: { type: "string" }, notes: { type: "string" }, keywords: stringArray, searchIntent: { type: "string" }, rationale: { type: "string" } } } } },
}

/** Applies a G1 fix: wording of the selected idea and the Spec only; keywords and evidence never change. */
export function applySpecFix(article: any, fix: any) {
  const text = (value: unknown, fallback: unknown) => typeof value === "string" && value.trim() ? value.trim() : fallback
  const list = (value: unknown, fallback: unknown) => Array.isArray(value) && value.length ? value.map(String).map((item) => item.trim()).filter(Boolean) : fallback
  const ideas = (article.coreIdeaSuggestions ?? []).map((idea: any) => idea.id !== article.selectedCoreIdeaId ? idea : {
    ...idea,
    ...Object.fromEntries(["title", "angleLabel", "angleDescription", "mainArgument", "targetAudience", "recommendedTone"].map((key) => [key, text(fix?.idea?.[key], idea[key])])),
  })
  const idea = ideas.find((item: any) => item.id === article.selectedCoreIdeaId)
  const spec = sanitizeBatchArticleSpec({
    ...article.articleSpec,
    thesis: text(fix?.articleSpec?.thesis, article.articleSpec?.thesis),
    brandPov: text(fix?.articleSpec?.brandPov, article.articleSpec?.brandPov),
    expectedReaderOutcome: text(fix?.articleSpec?.expectedReaderOutcome, article.articleSpec?.expectedReaderOutcome),
    mustCover: list(fix?.articleSpec?.mustCover, article.articleSpec?.mustCover),
    optionalCoverage: list(fix?.articleSpec?.optionalCoverage, article.articleSpec?.optionalCoverage),
    ctaObjective: text(fix?.articleSpec?.ctaObjective, article.articleSpec?.ctaObjective),
    audience: idea?.targetAudience || article.articleSpec?.audience,
  })
  return {
    coreIdeaSuggestions: ideas, articleSpec: spec, articleSpecFingerprint: canonicalSpecFingerprint(spec),
    ...(idea ? { title: idea.title, topic: idea.title, angle: idea.angleLabel, targetAudience: idea.targetAudience || spec.audience, tone: idea.recommendedTone } : {}),
  }
}

/** Applies a G2 fix to existing sections by ID; null when it would break the outline (IDs, unique headings, required headings). */
export function applyOutlineFix(article: any, fix: any) {
  const byId = new Map((Array.isArray(fix?.sections) ? fix.sections : []).map((section: any) => [String(section?.id), section]))
  const text = (value: unknown, fallback: unknown) => typeof value === "string" && value.trim() ? value.trim() : fallback
  const outline = (article.outline ?? []).map((section: any) => {
    const next: any = byId.get(section.id)
    return next ? { ...section, heading: text(next.heading, section.heading), notes: text(next.notes, section.notes), rationale: text(next.rationale, section.rationale), searchIntent: text(next.searchIntent, section.searchIntent), keywords: Array.isArray(next.keywords) && next.keywords.length ? next.keywords.map(String) : section.keywords } : section
  })
  const headings = outline.map((section: any) => String(section.heading).toLocaleLowerCase())
  if (new Set(headings).size !== headings.length || validateOutlineStructure(outline, article.outlineStructure).length) return null
  return outline
}

