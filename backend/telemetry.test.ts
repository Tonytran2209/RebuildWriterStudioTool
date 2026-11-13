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
