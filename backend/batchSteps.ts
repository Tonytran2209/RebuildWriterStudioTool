// Sub-jobs of one batch article, from taking it from the Content Plan to a checked draft.
// Shared by the batch runner (step timings) and the AI Agent Lab report (declared pipeline).
export type BatchStepKey = "plan" | "seo" | "spec" | "outline" | "draft" | "quality"
export type BatchStepRun = { key: BatchStepKey; label: string; startedAt: string; endedAt: string | null; status: "running" | "completed" | "failed" }
export const batchStepLabels: Record<BatchStepKey, string> = {
  plan: "Nhận bài từ Content Plan",
  seo: "Nghiên cứu từ khóa SEO",
  spec: "Article Spec & Core Idea",
  outline: "Lập outline",
  draft: "Viết draft",
  quality: "Kiểm tra chất lượng",
}
export const BATCH_ARTICLE_JOB = "Writer batch article"

// app-monitoring profile-v1: the Main Job and its sub-jobs in pipeline order. No title, so AI Agent
// Lab keeps showing the content-workload card in its technical report.
export const labProfile = {
  version: "profile-v1",
  mainJob: { job: BATCH_ARTICLE_JOB, steps: Object.values(batchStepLabels) },
}
