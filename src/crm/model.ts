import type { AppConfig, Article, ContentPlan, DocumentFile, PipelineSettings } from "../types/index.ts"
import { aiApproval, articleStage } from "../lib/pipeline.ts"
import { isArticleCompleted } from "../lib/workflowGuards.ts"
import { articleSpecFingerprint } from "../lib/articleSpec.ts"

// Vocabulary of twenty-demo-ui pipeline-crm.html, filled from real Writer Studio records.
export type CrmStatus = "queued" | "running" | "failed" | "completed"
export type HumanStatus = "not" | "approved" | "revision"
export type ArticleType = "A" | "B" | "C" | "ED"

export const GATES = [
  { id: 1, label: "G1 Research / Topic", short: "G1", color: "purple", icon: "bulb", step: 2 },
  { id: 2, label: "G2 Outline", short: "G2", color: "sky", icon: "list-tree", step: 3 },
  { id: 3, label: "G3 Final Article", short: "G3", color: "turq", icon: "file-text", step: 4 },
  { id: 4, label: "AI Approval", short: "AI", color: "yellow", icon: "shield-check", step: 4 },
] as const

export type CrmArticle = {
  a: Article
  id: string
  title: string
  topic: string
  keyword: string
  type: ArticleType
  status: CrmStatus
  /** 0 queued, 1–3 gates, 4 AI approval, 5 completed. */
  gate: number
  failGate?: number
  failReason?: string
  score: number | null
  human: { status: HumanStatus; reviewer?: string; comment?: string; at?: string }
  planId?: string
  batchId?: string
  createdAt: string
  startedAt?: string | null
}

const GATE_OF = { queued: 0, g1: 1, g2: 2, g3: 3, ai: 4, failed: 1, completed: 5 } as const

export function toCrmArticle(a: Article, settings: PipelineSettings): CrmArticle {
  const approval = aiApproval(a, settings)
  const reached = GATE_OF[articleStage({ ...a, batchStatus: undefined })]
  const base = {
    a, id: a.id,
    title: a.title?.trim() || a.topic || "Bài viết",
    topic: a.contentPlanInput && a.topic ? a.topic : a.topic || a.title,
    keyword: a.articleSpec?.primaryQuery || a.keywords?.split(",")[0]?.trim() || "",
    type: (a.activityType === "editorial-originality" ? "ED" : a.selectedContentTypeSnapshot?.typeGroup ?? "A") as ArticleType,
    score: approval.score,
    human: a.humanReview
      ? { status: (a.humanReview.status === "approved" ? "approved" : "revision") as HumanStatus, reviewer: a.humanReview.reviewer, comment: a.humanReview.comment, at: a.humanReview.reviewedAt }
      : { status: "not" as HumanStatus },
    planId: a.contentPlanId,
    batchId: a.activityKind === "batch" ? a.activityId : undefined,
    createdAt: a.createdAt,
    startedAt: a.batchStartedAt ?? a.coreIdeaScannedAt ?? null,
  }
  // New flow (spec §3): AI Approval ≥ threshold completes the article; a manual completion also counts.
  if (isArticleCompleted(a) || approval.state === "approved") return { ...base, status: "completed", gate: 5 }
  if (a.batchStatus === "failed") return { ...base, status: "failed", gate: Math.max(1, Math.min(4, reached)), failGate: Math.max(1, Math.min(4, reached)), failReason: a.batchError || "Batch error" }
  const busy = a.batchStatus === "running" || a.batchStatus === "queued"
  if (approval.state === "rejected" && !busy)
    return { ...base, status: "failed", gate: 4, failGate: 4, failReason: approval.hardBlocked ? `AI Review: evidence not supported (${approval.score}%)` : `AI Review ${approval.score}% < ${settings.threshold}%` }
  if ((a.batchStatus === "queued" || a.batchStatus === "paused") && reached <= 1 && !a.coreIdeaSuggestions?.length) return { ...base, status: "queued", gate: 0 }
  return { ...base, status: "running", gate: Math.max(1, Math.min(4, reached)) }
}

export type CrmBatch = { id: string; planId?: string; idx: number; articles: CrmArticle[]; done: number; status: "queued" | "running" | "completed" | "attention"; schedule: string; paused: boolean }

export function batchesOf(articles: CrmArticle[]): CrmBatch[] {
  const groups = new Map<string, CrmArticle[]>()
  for (const a of articles) if (a.batchId) groups.set(a.batchId, [...(groups.get(a.batchId) ?? []), a])
  const list = [...groups.entries()].map(([id, items]) => {
    const st = items.map(a => a.status)
    const schedule = items.map(a => a.a.batchStartedAt || a.createdAt).sort()[0]
    return {
      id, planId: items[0].planId, idx: 0, articles: items,
      done: st.filter(s => s === "completed").length,
      status: st.every(s => s === "completed") ? "completed" as const
        : items.some(a => a.a.batchStatus === "running") ? "running" as const
        : st.some(s => s === "failed") && st.every(s => s === "completed" || s === "failed") ? "attention" as const : "queued" as const,
      schedule,
      paused: items.some(a => a.a.batchStatus === "paused") && !items.some(a => a.a.batchStatus === "running"),
    }
  }).sort((x, y) => x.schedule.localeCompare(y.schedule))
  const seen = new Map<string, number>()
  for (const b of list) { const key = b.planId ?? ""; const n = (seen.get(key) ?? 0) + 1; seen.set(key, n); b.idx = n }
  return list
}

export function planStats(articles: CrmArticle[]) {
  const n = articles.length, c = articles.filter(a => a.status === "completed").length
  return { n, c, f: articles.filter(a => a.status === "failed").length, r: articles.filter(a => a.status === "running").length, pct: n ? Math.round(c / n * 100) : 0 }
}

export type CrmPlan = { id: string; name: string; plan: ContentPlan; articles: CrmArticle[]; created: string; perBatch: number }

export function plansOf(contentPlans: ContentPlan[], articles: CrmArticle[], settings: PipelineSettings): CrmPlan[] {
  return contentPlans.map(plan => {
    const items = articles.filter(a => a.planId === plan.id)
    return { id: plan.id, name: plan.name, plan, articles: items, created: plan.createdAt, perBatch: Math.max(...items.map(a => a.a.batchArticleIds?.length || 0), 0) || settings.perBatch }
  }).sort((x, y) => y.created.localeCompare(x.created))
}

/* ─── Storage (5 groups) over real Knowledge & Rules files ─────────────── */

export const STORAGE_GROUPS = [["Domain Knowledge", "red"], ["Playbooks", "purple"], ["Standards", "sky"], ["Voice & Style", "pink"], ["Source data", "turq"]] as const
export type StorageDoc = { id: string; g: string; name: string; st: "ok" | "partial" | "draft" | "missing"; used: number[]; types: ArticleType[]; note: string; updatedAt?: string; file?: DocumentFile }

const SHIP_STEPS = [2, 3, 4] as const
export function groupOf(file: DocumentFile): string {
  const name = file.name.toLowerCase()
  if (file.category === "kb") return /plan|topic|priority/.test(name) ? "Source data" : "Domain Knowledge"
  if (/checklist|standard|link|upload|quy tắc/.test(name)) return "Standards"
  if (/tone|voice|style|giọng/.test(name)) return "Voice & Style"
  return "Playbooks"
}
export function usedAt(file: DocumentFile, config: AppConfig): number[] {
  const key = file.category === "kb" ? "kb" : "rules"
  return SHIP_STEPS.filter(step => config.stepConfigs[step]?.fileAccess?.[key]?.includes(file.id)).map(step => step - 1)
}
/** Spec §4 documents still missing from Storage; shown as Missing until a matching file exists. */
const REQUIRED: Array<[string, string, RegExp, number[]]> = [
  ["Standards", "Checklist Gate 1–2", /gate ?1|gate 1.?2|checklist g1/i, [1, 2]],
  ["Standards", "Quy tắc chỉnh sửa", /chỉnh sửa|edit(ing)? rule/i, [4]],
  ["Domain Knowledge", "Vocabulary Library", /vocab/i, [3]],
  ["Playbooks", "Writing Patterns", /writing pattern/i, [2, 3]],
]
export function storageDocs(files: DocumentFile[], config: AppConfig, approvedArticles: number): StorageDoc[] {
  const real: StorageDoc[] = files.filter(f => f.category === "kb" || f.category === "rules").map(file => ({
    id: file.id, g: groupOf(file), name: file.name, st: file.scanStatus === "error" ? "partial" : "ok", used: usedAt(file, config),
    types: ["A", "B", "C", "ED"], note: file.scanStatus === "error" ? "Không đọc được nội dung" : "", updatedAt: file.contentUpdatedAt || file.uploadedAt, file,
  }))
  const missing: StorageDoc[] = REQUIRED.filter(([, , test]) => !files.some(f => test.test(f.name))).map(([g, name, , used], i) => ({ id: `missing-${i}`, g, name, st: "missing", used, types: ["A", "B", "C", "ED"], note: "Chưa có trong Storage" }))
  const approved: StorageDoc = { id: "approved-articles", g: "Playbooks", name: "Approved Articles", st: approvedArticles ? "ok" : "missing", used: [2, 3], types: ["A", "B", "C", "ED"], note: approvedArticles ? `${approvedArticles} human-confirmed` : "Chưa có bài nào được người xác nhận" }
  return [...real, ...missing, approved]
}

/** Toggle a file's Shipper access for one gate (1–3 → steps 2–4). */
export function toggleShip(config: AppConfig, file: DocumentFile, gate: number): AppConfig {
  const step = gate + 1, key = file.category === "kb" ? "kb" : "rules"
  const current = config.stepConfigs[step]
  if (!current) return config
  const list = current.fileAccess?.[key] ?? []
  const next = list.includes(file.id) ? list.filter(id => id !== file.id) : [...list, file.id]
  return { ...config, stepConfigs: { ...config.stepConfigs, [step]: { ...current, fileAccess: { ...current.fileAccess, [key]: next } } } }
}

/** Manual idea pick: same fields the runner sets at G1; a different idea clears G2/G3 output. */
export function selectIdeaPatch(article: Article, ideaId: string): Partial<Article> {
  const idea = article.coreIdeaSuggestions?.find(item => item.id === ideaId)
  if (!idea) return {}
  const changed = article.selectedCoreIdeaId !== idea.id
  const spec = article.articleSpec ? { ...article.articleSpec, primaryQuery: idea.primaryKeyword || article.articleSpec.primaryQuery, secondaryQueries: idea.secondaryKeywords?.length ? idea.secondaryKeywords : article.articleSpec.secondaryQueries, thesis: idea.mainArgument, audience: idea.targetAudience || article.articleSpec.audience } : null
  return {
    selectedCoreIdeaId: idea.id, title: idea.title, topic: idea.title, angle: idea.angleLabel,
    keywords: [idea.primaryKeyword, ...(idea.secondaryKeywords ?? [])].filter(Boolean).join(", "),
    targetAudience: idea.targetAudience, tone: idea.recommendedTone, wordCount: idea.recommendedWordCount,
    articleSpec: spec, articleSpecFingerprint: spec ? articleSpecFingerprint(spec) : article.articleSpecFingerprint,
    ...(changed ? { outline: [], outlineNeedsRegeneration: true, draft: "", draftNeedsRegeneration: true, qualityReport: null } : {}),
  }
}
