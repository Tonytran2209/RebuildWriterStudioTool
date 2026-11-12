import { batchStepLabels, type BatchStepKey, type BatchStepRun } from "./batchSteps.ts";

export type TelemetryStatus = "SUCCESS" | "ERROR";

export interface TelemetryStage {
  code: string;
  name: string;
  nameEn?: string;
  durationMs: number;
  status: TelemetryStatus;
}

export interface SendArticleTelemetryOptions {
  runId?: string;
  workload?: string;
  stages: TelemetryStage[];
  status?: TelemetryStatus;
  errorMessage?: string;
  durationMs?: number;
  responseTimeMs?: number;
  clickLatencyMs?: number;
}

export const STAGE_CONFIG: Record<BatchStepKey, { nameEn: string }> = {
  plan: { nameEn: "Article Selection" },
  seo: { nameEn: "SEO Research" },
  spec: { nameEn: "Article Spec & Core Idea" },
  outline: { nameEn: "Outline Generation" },
  draft: { nameEn: "Draft Writing" },
  quality: { nameEn: "Quality Check" },
  imageStyleSave: { nameEn: "Save Image Style" },
  imageStyleApprove: { nameEn: "Approve Image Style" },
  imageStyleSync: { nameEn: "Sync Image Library" },
  imageGenerate: { nameEn: "Generate Illustration" },
  imageInsert: { nameEn: "Insert Image into Draft" },
};

const TOOL_SLUG = "writer-studio";
const JOB_NAME = "Writer article";
const DEFAULT_DASHBOARD_URL = "https://dashboard-tool-performance.up.railway.app";
const TIMEOUT_MS = 3000;

/**
 * Chuyển đổi danh sách BatchStepRun sang định dạng chuẩn TelemetryStages
 */
export function convertStepRunsToTelemetryStages(stepRuns: BatchStepRun[]): TelemetryStage[] {
  return stepRuns
    .filter((step) => Boolean(step && step.startedAt))
    .map((step) => {
      const start = Date.parse(step.startedAt);
      const end = step.endedAt ? Date.parse(step.endedAt) : Date.now();
      const durationMs = Math.max(1, end - start);
      const conf = STAGE_CONFIG[step.key];
      return {
        code: step.key,
        name: step.label || batchStepLabels[step.key] || step.key,
        nameEn: conf?.nameEn,
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

    const payload = {
      schemaVersion: "2.0",
      runId: options.runId || `run_${Date.now()}`,
      toolSlug: TOOL_SLUG,
      jobName: JOB_NAME,
      status: options.status ?? "SUCCESS",
      workload: options.workload || "1 SEO article",
      errorMessage: options.errorMessage || null,
      durationMs:
        options.durationMs ??
        options.stages.reduce((sum, s) => sum + s.durationMs, 0),
      responseTimeMs: options.responseTimeMs ?? (options.stages[0]?.durationMs || 150),
      clickLatencyMs: options.clickLatencyMs ?? 90,
      stages: options.stages,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${baseUrl}/api/webhooks/telemetry/${TOOL_SLUG}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return res.ok;
  } catch {
    // Luôn nuốt lỗi để bảo đảm an toàn luồng nghiệp vụ
    return false;
  }
}
