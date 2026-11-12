// Sub-jobs of one batch article, from taking it from the Content Plan to a checked draft.
// Shared by the batch runner (step timings) and the AI Agent Lab report (declared pipeline).
export type BatchStepKey = "plan" | "seo" | "spec" | "outline" | "draft" | "quality" | "imageStyleSave" | "imageStyleApprove" | "imageStyleSync" | "imageGenerate" | "imageInsert"
export type BatchStepRun = { key: BatchStepKey; label: string; startedAt: string; endedAt: string | null; status: "running" | "completed" | "failed" }
export const batchStepLabels: Record<BatchStepKey, string> = {
  plan: "Nhận bài từ Content Plan",
  seo: "Nghiên cứu từ khóa SEO",
  spec: "Article Spec & Core Idea",
  outline: "Lập outline",
  draft: "Viết draft",
  quality: "Kiểm tra chất lượng",
  imageStyleSave: "Lưu phong cách ảnh",
  imageStyleApprove: "Duyệt phong cách ảnh",
  imageStyleSync: "Đồng bộ thư viện ảnh",
  imageGenerate: "Tạo ảnh minh họa",
  imageInsert: "Chèn ảnh vào bài",
}
// Main Job for every article, batch or step-by-step (single). Named at report time, so history of
// earlier batch articles is reported under the same name.
export const ARTICLE_JOB = "Writer article"
export const BATCH_ARTICLE_JOB = ARTICLE_JOB

// app-monitoring profile-v1: the Main Job and its sub-jobs in pipeline order. No title, so AI Agent
// Lab keeps showing the content-workload card in its technical report.
export const labProfile = {
  version: "profile-v1",
  mainJob: { job: ARTICLE_JOB, steps: Object.values(batchStepLabels) },
  // Kept from AI Agent Lab's earlier built-in target for batch articles.
  jobTargets: { [ARTICLE_JOB]: 10 },
  // What the browser KPIs measure (ui-kpi-v2, src/components/workspace/Step3Outline.tsx).
  kpiDescriptions: {
    responseTime: "Bấm Tạo outline, Tạo ảnh hoặc Chèn ảnh, hoặc Lưu/Duyệt phong cách ảnh (tính từ sự kiện bấm) → khung hình thứ hai sau khi giao diện xác nhận máy chủ đã nhận việc tạo outline, đưa ảnh vào hàng đợi, lưu vị trí chèn ảnh hoặc lưu phiên bản style",
    clickLatency: "Bấm Tạo outline, Tạo ảnh hoặc Chèn ảnh, hoặc Lưu/Duyệt phong cách ảnh (tính từ sự kiện bấm) → khung hình thứ hai sau khi trạng thái đang xử lý được hiển thị, tức khung đầu tiên đã có cơ hội vẽ",
  },
}
