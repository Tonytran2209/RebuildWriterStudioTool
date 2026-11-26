// Sub-jobs of one batch article, from taking it from the Content Plan to a checked draft.
// Shared by the batch runner (step timings) and the AI Agent Lab report (declared pipeline).
export type BatchStepKey = "plan" | "seo" | "spec" | "specReview" | "outline" | "outlineReview" | "draft" | "quality"
export type BatchStepRun = { key: BatchStepKey; label: string; startedAt: string; endedAt: string | null; status: "running" | "completed" | "failed" }
export const batchStepLabels: Record<BatchStepKey, string> = {
  plan: "Nhận bài từ Content Plan",
  seo: "Nghiên cứu từ khóa SEO",
  spec: "Article Spec & Core Idea",
  // Run only when Settings turns on G1/G2 self-review and the Gate has Standards ticked; skipped runs are not recorded.
  specReview: "Kiểm tra Core Idea",
  outline: "Lập outline",
  outlineReview: "Kiểm tra outline",
  draft: "Viết draft",
  quality: "Kiểm tra chất lượng",
}
// Main Job for every article, batch or step-by-step (single). Named at report time, so history of
// earlier batch articles is reported under the same name.
export const ARTICLE_JOB = "Writer article"
export const BATCH_ARTICLE_JOB = ARTICLE_JOB
// Runs once per Content Plan before its articles exist, so its runs name the Main Job but no parent run.
export const CLASSIFY_PLAN_JOB = "Phân loại Content Plan"

// app-monitoring profile-v1: the Main Job and its sub-jobs in pipeline order. No title, so AI Agent
// Lab keeps showing the content-workload card in its technical report.
export const labProfile = {
  version: "profile-v1",
  mainJob: { job: ARTICLE_JOB, steps: [CLASSIFY_PLAN_JOB, ...Object.values(batchStepLabels)] },
  // Kept from AI Agent Lab's earlier built-in target for batch articles.
  jobTargets: { [ARTICLE_JOB]: 10 },
  // What the browser KPIs measure (ui-kpi-v2: src/crm/ui.tsx trackHandoff).
  kpiDescriptions: {
    responseTime: "Bấm Generate (Add Plan), Retry, Tạo lại G1/G2/Draft hoặc Chấm lại AI trong CRM (tính từ sự kiện bấm) → khung hình thứ hai sau khi giao diện xác nhận máy chủ đã nhận việc (batch đã tạo và chạy, bài đã vào hàng đợi)",
    clickLatency: "Bấm Generate (Add Plan), Retry, Tạo lại G1/G2/Draft hoặc Chấm lại AI trong CRM (tính từ sự kiện bấm) → khung hình thứ hai sau khi trạng thái đang xử lý được hiển thị",
  },
}
