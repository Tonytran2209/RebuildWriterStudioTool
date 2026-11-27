import { batchStepLabels, type BatchStepKey, type BatchStepRun } from "./batchSteps.ts";

export type TelemetryStatus = "SUCCESS" | "ERROR";

export interface TelemetryStage {
  code: string;
  name: string;
  nameEn?: string;
  description?: string;
  summary?: string;
  stepType?: "AI" | "NON_AI";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs: number;
  status: TelemetryStatus;
}

export interface AiUsageCall {
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  costUsd?: number | null;
}

export interface SendArticleTelemetryOptions {
  runId?: string;
  workload?: string;
  stages: TelemetryStage[];
  aiUsageByStep?: Record<string | number, AiUsageCall[]>;
  status?: TelemetryStatus;
  errorMessage?: string;
  durationMs?: number;
}

export const STAGE_CONFIG: Record<BatchStepKey, { nameEn: string; stepType: "AI" | "NON_AI"; description: string }> = {
  plan: { nameEn: "Article Selection", stepType: "NON_AI", description: "Tiếp nhận bài viết và metadata từ Content Plan." },
  seo: { nameEn: "SEO Research", stepType: "AI", description: "AI nghiên cứu từ khóa chính/phụ và search intent SEO." },
  competitors: { nameEn: "Competitor Analysis", stepType: "AI", description: "Đọc trang đối thủ từ kết quả nghiên cứu keyword và tóm tắt cấu trúc, điểm mạnh, điểm yếu, khoảng trống." },
  spec: { nameEn: "Article Spec & Core Idea", stepType: "AI", description: "AI xây dựng thông số bài viết (Article Spec) và ý tưởng cốt lõi." },
  specReview: { nameEn: "Core Idea Self-Review", stepType: "AI", description: "AI chấm Core Idea theo Standards của G1 và sửa lỗi." },
  outline: { nameEn: "Outline Generation", stepType: "AI", description: "AI lập dàn ý H2/H3 chuẩn cấu trúc SEO." },
  outlineReview: { nameEn: "Outline Self-Review", stepType: "AI", description: "AI chấm outline theo Standards của G2 và sửa lỗi." },
  draft: { nameEn: "Draft Writing", stepType: "AI", description: "AI viết bản thảo bài viết hoàn chỉnh theo outline và nguồn dẫn chứng." },
  quality: { nameEn: "Quality Check", stepType: "AI", description: "AI kiểm tra chất lượng, internal links và tính xác thực." },
};

const TOOL_SLUG = "writer-studio";
const JOB_NAME = "Writer article";
const DEFAULT_DASHBOARD_URL = "https://dashboard-tool-performance.up.railway.app";
const TIMEOUT_MS = 3000;

const STAGE_TO_LEGACY_USAGE_KEY: Partial<Record<BatchStepKey, string>> = {
  spec: "2",
  outline: "3",
  draft: "4",
};

/**
 * Chuyển đổi danh sách BatchStepRun sang định dạng chuẩn TelemetryStages
 */
export function convertStepRunsToTelemetryStages(
  stepRuns: BatchStepRun[],
  aiUsageByStep?: Record<string | number, AiUsageCall[]>,
): TelemetryStage[] {
  return stepRuns
    .filter((step) => Boolean(step && step.startedAt && step.endedAt))
    .map((step) => {
      const start = Date.parse(step.startedAt);
      const end = Date.parse(step.endedAt!);
      const durationMs = Math.max(1, end - start);
      const conf = STAGE_CONFIG[step.key];
      const legacyKey = STAGE_TO_LEGACY_USAGE_KEY[step.key];
      const stepCalls = aiUsageByStep?.[step.key] ?? (legacyKey ? aiUsageByStep?.[legacyKey] : undefined) ?? [];
      const inputTokens = stepCalls.reduce((sum, c) => sum + (Number(c?.inputTokens) || 0) + (Number(c?.cachedInputTokens) || 0), 0);
      const outputTokens = stepCalls.reduce((sum, c) => sum + (Number(c?.outputTokens) || 0), 0);
      const costUsd = stepCalls.reduce((sum, c) => sum + (c?.costUsd != null ? Number(c.costUsd) : 0), 0);
      const model = stepCalls.map((c) => c?.model).filter((m): m is string => Boolean(m)).at(-1);

      return {
        code: step.key,
        name: step.label || batchStepLabels[step.key] || step.key,
        nameEn: conf?.nameEn,
        description: conf?.description,
        summary: conf?.description || step.label || step.key,
        stepType: conf?.stepType || "NON_AI",
        ...(model ? { model } : {}),
        ...(inputTokens > 0 ? { inputTokens } : {}),
        ...(outputTokens > 0 ? { outputTokens } : {}),
        ...(costUsd > 0 ? { costUsd: Number(costUsd.toFixed(6)) } : {}),
        durationMs,
        status: step.status === "failed" ? "ERROR" : "SUCCESS",
      };
    });
}

/**
 * Gửi telemetry về Control Plane Dashboard.
 * Fail-safe 100%: không ném lỗi ra ngoài làm sập app chính.
 */
export async function sendArticleRunTelemetry(options: SendArticleTelemetryOptions): Promise<boolean> {
  if (process.env.NODE_ENV === "test" || process.env.FLEARNING_TELEMETRY_DISABLED === "true") {
    return false;
  }

  try {
    const baseUrl = (process.env.FLEARNING_DASHBOARD_URL || DEFAULT_DASHBOARD_URL).replace(/\/+$/, "");
    const secret = process.env.FLEARNING_TELEMETRY_SECRET || "";

    const allCalls = options.aiUsageByStep
      ? Object.values(options.aiUsageByStep).flat().filter(Boolean)
      : null;

    const totalInputTokens = allCalls
      ? allCalls.reduce((sum, c) => sum + (Number(c.inputTokens) || 0) + (Number(c.cachedInputTokens) || 0), 0)
      : options.stages.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0);
    const totalOutputTokens = allCalls
      ? allCalls.reduce((sum, c) => sum + (Number(c.outputTokens) || 0), 0)
      : options.stages.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0);
    const totalCostUsd = allCalls
      ? allCalls.reduce((sum, c) => sum + (c.costUsd != null ? Number(c.costUsd) : 0), 0)
      : options.stages.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
    const llmCallsCount = allCalls
      ? allCalls.length
      : options.stages.filter((s) => s.stepType === "AI" && ((s.inputTokens ?? 0) > 0 || (s.outputTokens ?? 0) > 0 || Boolean(s.model))).length;
    const lastModel = allCalls
      ? allCalls.map((c) => c.model).filter((m): m is string => Boolean(m)).at(-1)
      : options.stages.map((s) => s.model).filter((m): m is string => Boolean(m)).at(-1);

    const llmUsage =
      totalInputTokens > 0 || totalOutputTokens > 0 || llmCallsCount > 0
        ? {
            ...(lastModel ? { model: lastModel } : {}),
            ...(totalInputTokens > 0 ? { inputTokens: totalInputTokens } : {}),
            ...(totalOutputTokens > 0 ? { outputTokens: totalOutputTokens } : {}),
            ...(totalCostUsd > 0 ? { estimatedCostUsd: Number(totalCostUsd.toFixed(6)) } : {}),
            ...(llmCallsCount > 0 ? { llmCallsCount } : {}),
          }
        : undefined;

    const payload = {
      schemaVersion: "2.2",
      runId: options.runId || `run_${Date.now()}`,
      toolSlug: TOOL_SLUG,
      jobName: JOB_NAME,
      status: options.status ?? "SUCCESS",
      workload: options.workload || "1 SEO article",
      errorMessage: options.errorMessage || null,
      durationMs:
        options.durationMs ??
        options.stages.reduce((sum, s) => sum + s.durationMs, 0),
      ...(llmUsage ? { llmUsage } : {}),
      stages: options.stages,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}/api/webhooks/telemetry/${TOOL_SLUG}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Luôn nuốt lỗi để bảo đảm an toàn luồng nghiệp vụ
    return false;
  }
}
