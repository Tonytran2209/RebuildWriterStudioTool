import type { Article, HumanReview, PipelineSettings, QualityGateCheck } from "../types/index.ts"
import { isArticleCompleted } from "./workflowGuards.ts"

// Provisional values for the trial run (docs/AI-PIPELINE-UPGRADE.md §8). Admins change them in Settings → Pipeline.
export const DEFAULT_PIPELINE: PipelineSettings = {
  threshold: 90,
  options: 3,
  revisionRounds: 1,
  perBatch: 5,
  maxParallel: 2,
  noPass: "best-flagged",
  reviewSample: 20,
  keepImages: true,
}

export function pipelineSettings(config: { pipeline?: Partial<PipelineSettings> } | null | undefined): PipelineSettings {
  return { ...DEFAULT_PIPELINE, ...(config?.pipeline ?? {}) }
}

export type PipelineStage = "queued" | "g1" | "g2" | "g3" | "ai" | "failed" | "completed"
export const PIPELINE_STAGES: PipelineStage[] = ["queued", "g1", "g2", "g3", "ai", "failed", "completed"]

/** Maps the current 3-step record onto the 3-gate model: Core Idea = G1, Outline = G2, Draft = G3. */
export function articleStage(article: Article): PipelineStage {
  if (isArticleCompleted(article)) return "completed"
  if (article.batchStatus === "failed") return "failed"
  if (article.draft?.trim()) return "ai"
  if (article.outline?.length) return "g3"
  if (article.selectedCoreIdeaId) return "g2"
  if (article.activityKind === "batch" && article.batchStatus === "queued" && !article.coreIdeaSuggestions?.length) return "queued"
  return "g1"
}

// Hard blocks: an unsupported claim fails approval regardless of the score.
const HARD_BLOCK_IDS = new Set(["evidence-support"])

export type AiApproval = {
  state: "pending" | "approved" | "rejected"
  score: number | null
  failed: QualityGateCheck[]
  hardBlocked: boolean
}

export function aiApproval(article: Article, settings: PipelineSettings): AiApproval {
  const checks = article.qualityReport?.checks ?? []
  if (!checks.length) return { state: "pending", score: null, failed: [], hardBlocked: false }
  const points = checks.reduce((sum, check) => sum + (check.status === "pass" ? 1 : check.status === "warning" ? 0.5 : 0), 0)
  const score = Math.round((points / checks.length) * 100)
  const failed = checks.filter(check => check.status === "fail")
  const hardBlocked = failed.some(check => check.blocking || HARD_BLOCK_IDS.has(check.id))
  return { state: score >= settings.threshold && !hardBlocked ? "approved" : "rejected", score, failed, hardBlocked }
}

export function humanReviewStatus(article: Article): HumanReview["status"] | "not_reviewed" {
  return article.humanReview?.status ?? "not_reviewed"
}

/** Deterministic sample: the same article is always in or out for a given rate. */
export function inReviewSample(articleId: string, rate: number): boolean {
  let hash = 0
  for (const char of articleId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 100 < Math.max(0, Math.min(100, rate))
}

export function firstPassApprovalRate(articles: Article[], settings: PipelineSettings): number | null {
  const scored = articles.map(article => aiApproval(article, settings)).filter(result => result.state !== "pending")
  if (!scored.length) return null
  return Math.round((scored.filter(result => result.state === "approved").length / scored.length) * 100)
}

export type RerunGate = 1 | 2 | 3 | 4

/**
 * Fields to clear so the resumable batch runner regenerates from `gate` onwards.
 * G1 Core Idea → G2 Outline → G3 Draft → 4 AI Review (re-check keeps the draft).
 */
export function rerunPatch(article: Pick<Article, "id" | "activityId" | "activityKind">, gate: RerunGate): Partial<Article> {
  const clear: Partial<Article> =
    gate === 1 ? { coreIdeaSuggestions: [], selectedCoreIdeaId: undefined, articleSpec: null, articleSpecFingerprint: null, outline: [], outlineNeedsRegeneration: true, draft: "", draftNeedsRegeneration: true, qualityReport: null, semanticReviewChecks: null, semanticReviewFingerprint: null }
    : gate === 2 ? { outline: [], outlineNeedsRegeneration: true, draft: "", draftNeedsRegeneration: true, qualityReport: null, semanticReviewChecks: null, semanticReviewFingerprint: null }
    : gate === 3 ? { draftNeedsRegeneration: true, qualityReport: null, semanticReviewChecks: null, semanticReviewFingerprint: null }
    : { qualityReport: null, semanticReviewChecks: null, semanticReviewFingerprint: null }
  // Older single articles join the pipeline as a one-article batch.
  const batch: Partial<Article> = article.activityKind === "batch" && article.activityId ? {} : { activityKind: "batch", activityId: article.activityId || `activity-${article.id}` }
  return { ...clear, ...batch, batchStatus: "queued", batchError: null, status: "review", completedAt: null, humanReview: null }
}
