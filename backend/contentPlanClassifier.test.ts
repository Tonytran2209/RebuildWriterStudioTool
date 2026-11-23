import test from "node:test"
import assert from "node:assert/strict"
import { quoteInSource, splitPlanChunks, verifiedClassificationItems } from "./contentPlanClassifier.ts"

test("plan chunks keep whole lines under the size limit", () => {
  const text = Array.from({ length: 50 }, (_, i) => `Topic ${i} — some planned article title`).join("\n")
  const chunks = splitPlanChunks(text, 200)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.length <= 200))
  assert.equal(chunks.join("\n"), text)
  assert.deepEqual(splitPlanChunks("one very long line", 5), ["one very long line"])
})

test("quotes match despite quote marks, dashes, markdown and spacing from extraction", () => {
  const source = "| 3 | **Notion vs ClickUp – which wins?** |  “honest” review |"
  assert.ok(quoteInSource(source, 'Notion vs  ClickUp - which wins?'))
  assert.ok(quoteInSource(source, '"honest" review'))
  assert.ok(!quoteInSource(source, "Asana vs Trello"))
  assert.ok(!quoteInSource(source, "   "))
})

test("AI topics not found in the source are dropped and reported, duplicates are removed", () => {
  const plan = { sources: [{ id: "s1", extractedContent: "Cluster A\nNotion vs ClickUp\nWhy teams burn out" }] }
  const { items, dropped } = verifiedClassificationItems([
    { title: "Notion vs ClickUp", contentGroup: "comparison-seo", confidence: 0.9, sourceId: "s1" },
    { title: "notion vs clickup", contentGroup: "comparison-seo", confidence: 0.9, sourceId: "s1" },
    { title: "Why Teams Burn Out", sourceQuote: "Why teams burn out", contentGroup: "editorial-originality", confidence: 0.5, sourceId: "s1" },
    { title: "An invented topic", contentGroup: "editorial-originality", confidence: 0.9, sourceId: "s1" },
  ], plan)
  assert.deepEqual(items.map(i => [i.title, i.type]), [["Notion vs ClickUp", "comparison-seo"], ["Why Teams Burn Out", "needs-review"]])
  assert.deepEqual(dropped, ["An invented topic"])
})
