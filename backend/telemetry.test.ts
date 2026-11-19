import test from "node:test";
import assert from "node:assert/strict";
import { convertStepRunsToTelemetryStages, sendArticleRunTelemetry } from "./telemetry.ts";
import type { BatchStepRun } from "./batchSteps.ts";

test("converts BatchStepRun array to TelemetryStage array with bilingual names", () => {
  const stepRuns: BatchStepRun[] = [
    {
      key: "plan",
      label: "Nhận bài từ Content Plan",
      startedAt: new Date(Date.now() - 1000).toISOString(),
      endedAt: new Date().toISOString(),
      status: "completed",
    },
    {
      key: "seo",
      label: "Nghiên cứu từ khóa SEO",
      startedAt: new Date(Date.now() - 500).toISOString(),
      endedAt: new Date().toISOString(),
      status: "failed",
    },
  ];

  const stages = convertStepRunsToTelemetryStages(stepRuns);
  assert.equal(stages.length, 2);
  assert.equal(stages[0].code, "plan");
  assert.equal(stages[0].name, "Nhận bài từ Content Plan");
  assert.equal(stages[0].nameEn, "Article Selection");
  assert.equal(stages[0].status, "SUCCESS");
  assert.ok(stages[0].durationMs > 0);

  assert.equal(stages[1].code, "seo");
  assert.equal(stages[1].nameEn, "SEO Research");
  assert.equal(stages[1].status, "ERROR");
});

test("maps numeric legacyStep aiUsageByStep, skips unfinished stages, and aggregates llmUsage in schema v2.2", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFetch = global.fetch;
  let capturedPayload: any = null;
  process.env.NODE_ENV = "production";

  try {
    global.fetch = (async (_url: string, init?: RequestInit) => {
      capturedPayload = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const stepRuns: BatchStepRun[] = [
      {
        key: "plan",
        label: "Nhận bài từ Content Plan",
        startedAt: new Date(Date.now() - 2000).toISOString(),
        endedAt: new Date(Date.now() - 1800).toISOString(),
        status: "completed",
      },
      {
        key: "draft",
        label: "Viết draft",
        startedAt: new Date(Date.now() - 1800).toISOString(),
        endedAt: new Date(Date.now() - 200).toISOString(),
        status: "completed",
      },
      {
        key: "quality",
        label: "Kiểm tra chất lượng",
        startedAt: new Date(Date.now() - 200).toISOString(),
        endedAt: null,
        status: "running",
      },
    ];

    const aiUsageByStep = {
      "2": [{ model: "gpt-6-sol", inputTokens: 1000, cachedInputTokens: 200, outputTokens: 300, costUsd: 0.004 }],
      "4": [{ model: "claude-sonnet-5-5", inputTokens: 5000, outputTokens: 1500, costUsd: 0.012 }],
    };

    const stages = convertStepRunsToTelemetryStages(stepRuns, aiUsageByStep);

    assert.equal(stages.length, 2);
    assert.equal(stages[0].stepType, "NON_AI");
    assert.equal(stages[0].inputTokens, undefined);
    assert.ok(typeof stages[0].summary === "string" && stages[0].summary.length > 0);
    assert.equal(stages[1].stepType, "AI");
    assert.equal(stages[1].inputTokens, 5000);
    assert.equal(stages[1].outputTokens, 1500);
    assert.equal(stages[1].costUsd, 0.012);

    const ok = await sendArticleRunTelemetry({ runId: "run_unit_v22", stages, aiUsageByStep });
    assert.equal(ok, true);
    assert.equal(capturedPayload.schemaVersion, "2.2");
    assert.equal(capturedPayload.model, undefined);
    assert.equal(capturedPayload.responseTimeMs, undefined);
    assert.equal(capturedPayload.clickLatencyMs, undefined);
    assert.equal(capturedPayload.llmUsage.inputTokens, 6200);
    assert.equal(capturedPayload.llmUsage.outputTokens, 1800);
    assert.equal(capturedPayload.llmUsage.estimatedCostUsd, 0.016);
    assert.equal(capturedPayload.llmUsage.llmCallsCount, 2);
    assert.equal(capturedPayload.llmUsage.model, "claude-sonnet-5-5");
  } finally {
    process.env.NODE_ENV = originalEnv;
    global.fetch = originalFetch;
  }
});

test("safely handles network errors without throwing", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => {
      throw new Error("Network timeout simulation");
    };

    const success = await sendArticleRunTelemetry({
      runId: "test_run",
      stages: [
        {
          code: "plan",
          name: "Nhận bài từ Content Plan",
          durationMs: 120,
          status: "SUCCESS",
        },
      ],
    });

    assert.equal(success, false);
  } finally {
    global.fetch = originalFetch;
  }
});
