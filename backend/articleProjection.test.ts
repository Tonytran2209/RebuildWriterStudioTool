import assert from "node:assert/strict"
import test from "node:test"
import { resolveArticleProjection } from "./articleProjection.ts"

const source = { id: "article", contentPlanId: "plan", contentPlanSourceItemId: "item", draft: "Keep this draft" }
const lookup = (rows: Record<string, any>) => async (table: string, id: string) => rows[`${table}/${id}`]

test("preserves existing plan and matching item references", async () => {
  const result = await resolveArticleProjection(source, lookup({
    "content_plans/plan": { id: "plan" },
    "content_plan_items/item": { id: "item", content_plan_id: "plan" },
  }))
  assert.deepEqual(result, source)
})

test("missing plan detaches relational references without modifying original payload", async () => {
  const result = await resolveArticleProjection(source, lookup({}))
  assert.equal(result.contentPlanId, null)
  assert.equal(result.contentPlanSourceItemId, null)
  assert.equal(result.draft, source.draft)
  assert.equal(source.contentPlanId, "plan")
  assert.equal(source.contentPlanSourceItemId, "item")
})

test("missing or mismatched item keeps valid plan and detaches only item", async () => {
  for (const item of [undefined, { id: "item", content_plan_id: "other-plan" }]) {
    const result = await resolveArticleProjection(source, lookup({
      "content_plans/plan": { id: "plan" },
      "content_plan_items/item": item,
    }))
    assert.equal(result.contentPlanId, "plan")
    assert.equal(result.contentPlanSourceItemId, null)
  }
})

test("lookup failures propagate instead of being mistaken for missing references", async () => {
  await assert.rejects(resolveArticleProjection(source, async () => {
    throw new Error("database unavailable")
  }), /database unavailable/)
})
