import test from "node:test"
import assert from "node:assert/strict"
import { mergeDuplicateTopics, numberedLines, planItemsFromPicks, sameTopic, sectionGroupAt, splitPlanChunks, titleGroup } from "./contentPlanClassifier.ts"

// Same shape as a real strategy doc: a cluster table, a priority list without groups, then an action
// plan whose numbered sections say Comparison / Editorial, and a mixed ICP section.
const PLAN = [
  "Editorial Strategy & Topic Map",          // 0
  "I. Cluster Framework",                    // 1
  "Cluster 1: Training That Doesn't Work",   // 2
  "Why employees skip, forget, or fail to apply training.", // 3 (table cell, not a topic)
  "II. 45 Priority Topics",                  // 4
  "Why healthcare communication breaks down even when the information is technically correct", // 5
  "When should training content be rebuilt instead of updated?", // 6
  "Some topics are hard to learn because the mental model is invisible", // 7
  "III. Action Plan Topics",                 // 8
  "1. Comparison Content",                   // 9
  "Motion Graphics vs Character Animation",  // 10
  "Customer Onboarding vs Product Training", // 11
  "2. Editorial Support Content (Wave 1–2)", // 12
  "Why healthcare communication breaks down even when info is correct", // 13
  "When medical animation is useful vs visual decoration", // 14
  "3. ICP Content (Agencies, SaaS)",         // 15
  "How to price animation subcontracting when quoting a client project", // 16
  "What makes training and healthcare animation different from general motion design", // 17
  "- How to structure a SaaS product explainer video that converts | saas explainer, product video", // 18
].join("\n")
const source = { id: "s1", extractedContent: PLAN }

test("lines go to the AI numbered, without empty or skipped lines, in chunks of whole lines", () => {
  const lines = numberedLines("a\n\nb\nlabel: x", line => line.startsWith("label"))
  assert.deepEqual(lines, ["0| a", "2| b"])
  const chunks = splitPlanChunks(Array.from({ length: 50 }, (_, i) => `${i}| Topic ${i}`).join("\n"), 120)
  assert.ok(chunks.length > 1 && chunks.every(c => c.length <= 120))
  assert.deepEqual(splitPlanChunks("one very long line", 5), ["one very long line"])
})

test("titles come from the file and the group follows section, then wording, then the AI", () => {
  const picks = [[5, "c"], [6, "e"], [7, "c"], [10, "e"], [11, "r"], [13, "c"], [14, "c"], [16, "e"], [17, "c"], [18, "e"], [99, "c"]]
  const { items, dropped } = planItemsFromPicks(picks, source)
  const byLine = Object.fromEntries(items.map(i => [i.sourceSectionId, i]))
  assert.equal(byLine["line-5"].title, "Why healthcare communication breaks down even when the information is technically correct")
  assert.equal(byLine["line-5"].type, "editorial-originality")      // "Why…" beats the AI's c
  assert.equal(byLine["line-6"].type, "comparison-seo")             // "instead of" beats the AI's e
  assert.equal(byLine["line-7"].type, "comparison-seo")             // no rule: the AI decides
  assert.equal(byLine["line-10"].type, "comparison-seo")            // section "Comparison Content" beats the AI's e
  assert.equal(byLine["line-11"].type, "comparison-seo")
  assert.equal(byLine["line-14"].type, "editorial-originality")     // section "Editorial…" beats "vs"
  assert.equal(byLine["line-16"].type, "comparison-seo")            // ICP section has no group: "how to price"
  assert.equal(byLine["line-17"].type, "comparison-seo")            // "different from"
  assert.equal(byLine["line-18"].title, "How to structure a SaaS product explainer video that converts")
  assert.deepEqual(byLine["line-18"].keywords, ["saas explainer", "product video"])
  assert.equal(byLine["line-18"].type, "editorial-originality")     // no rule: the AI decides
  assert.deepEqual(dropped, ["#99"])
})

test("numbered topics are not mistaken for section headings", () => {
  const lines = ["Comparison topics", "1. Notion vs ClickUp", "2. Why teams burn out"]
  assert.equal(sectionGroupAt(lines, 2, new Set([1, 2])), null)
  assert.equal(sectionGroupAt(["## Editorial", "Why X"], 1)?.group, "editorial-originality")
  const { items } = planItemsFromPicks([[1, "c"], [2, "c"]], { id: "s", extractedContent: lines.join("\n") })
  assert.deepEqual(items.map(i => [i.title, i.type]), [["Notion vs ClickUp", "comparison-seo"], ["Why teams burn out", "editorial-originality"]])
})

test("the same topic listed twice (shortened or reworded slightly) is merged; different topics are kept", () => {
  assert.ok(sameTopic("Why healthcare communication breaks down even when the information is technically correct", "Why healthcare communication breaks down even when info is correct"))
  assert.ok(sameTopic("When medical animation is useful — and when it is just visual decoration", "When medical animation is useful vs visual decoration"))
  assert.ok(sameTopic("Visual aids do not improve learning because they are visual — they work when they clarify the thinking task", "Visual aids do not improve learning because they are visual"))
  for (const [a, b] of [
    ["Explainer Video vs Product Demo", "Product Explainer vs Product Walkthrough"],
    ["Whiteboard vs Motion Graphics", "Motion Graphics vs Character Animation"],
    ["HCP Education vs Patient Education", "Patient Education Video vs Animation"],
    ["Why compliance training fails even when employees complete it", "Compliance training fails when it proves completion but not risk recognition"],
    ["Cybersecurity training becomes expensive when employees cannot recognize risk in real situations", "Cybersecurity training needs to prepare people for risky decisions, not just teach security rules"],
    ["Why compliance training fails even when employees complete it", "Why compliance training fails when you scale it across regions — and what localized animation does that translated text cannot"],
  ]) assert.ok(!sameTopic(a, b), `${a} / ${b}`)
  assert.deepEqual(mergeDuplicateTopics([{ title: "A vs B" }, { title: "a vs b" }, { title: "C vs D" }]).map(i => i.title), ["A vs B", "C vs D"])
  // The fuller first title stays; the group comes from the copy under an "Editorial" heading.
  const merged = mergeDuplicateTopics([
    { title: "When medical animation is useful — and when it is just visual decoration", type: "comparison-seo", confidence: 0.8 },
    { title: "When medical animation is useful vs visual decoration", type: "editorial-originality", confidence: 1, classificationReason: "Section" },
  ])
  assert.deepEqual(merged.map(i => [i.title, i.type]), [["When medical animation is useful — and when it is just visual decoration", "editorial-originality"]])
})

test("title wording rules", () => {
  assert.equal(titleGroup("Best LMS for healthcare"), "comparison-seo")
  assert.equal(titleGroup("Explainer video brief template for founders"), "comparison-seo")
  assert.equal(titleGroup("SCORM compliance does not mean the learning experience works"), "editorial-originality")
  assert.equal(titleGroup("Why X vs Y matters"), "comparison-seo")
  assert.equal(titleGroup("Storyboarding for learning should map understanding, not just scenes"), "editorial-originality")
  assert.equal(titleGroup("Learning tools can deliver content but they cannot design understanding"), "editorial-originality")
  assert.equal(titleGroup("Storyboarding for learning should map understanding"), null)
})

test("admin settings: edited prompt, rule toggles, unsure topics and merging", async () => {
  const { normalizeContentPlanSettings, DEFAULT_CONTENT_PLAN_SETTINGS: D, CLASSIFIER_ANSWER_FORMAT } = await import("../shared/contentPlanSettings.ts")
  const { compileRules, planItemsFromPicks, mergeDuplicateTopics, classifierPrompt, promptSettingsOf } = await import("./contentPlanClassifier.ts")
  // Unsafe or junk input is capped and defaulted, never passed through as regex; empty prompts fall back to the original.
  const s = normalizeContentPlanSettings({ comparisonHeadings: ["Buyer Guides", "", "(a|b)+"], editorialPhrases: ["^Is"], comparisonPhrases: ["top # tools"], rulesPrompt: "x".repeat(9000), systemPrompt: "  ", keepNeedsReview: "no", dailyAiLimit: 3 })
  assert.deepEqual(s.comparisonHeadings, ["buyer guides", "(a|b)+"])
  assert.equal(s.rulesPrompt.length, 8000)
  assert.equal(s.systemPrompt, D.systemPrompt)
  assert.equal(s.keepNeedsReview, true)
  assert.ok(!("dailyAiLimit" in s))
  const rules = compileRules(s)
  assert.equal(rules.section("3. Buyer guides for L&D"), "comparison-seo")
  assert.equal(rules.section("(a|b)+ literally"), "comparison-seo")
  assert.equal(rules.section("Anything else"), null)
  assert.equal(rules.title("Is microlearning dead"), "editorial-originality")
  assert.equal(rules.title("This is fine"), null) // ^ = start of title only
  assert.equal(rules.title("Top 7 tools for onboarding"), "comparison-seo")
  assert.equal(rules.title("Top tools for onboarding"), null) // # needs a number
  // Defaults keep the v3 behaviour.
  const d = compileRules(D)
  assert.equal(d.title("Best LMS for startups"), "comparison-seo")
  assert.equal(d.title("Why onboarding fails"), "editorial-originality")
  assert.equal(d.title("Articulate vs Rise: which is not worth it"), "comparison-seo")
  assert.equal(d.section("II. Comparisons"), "comparison-seo")
  // Switching the heading and wording rules off leaves the group to the AI.
  const plan = { id: "p", extractedContent: "## Comparison\n- Why onboarding fails" }
  assert.equal(planItemsFromPicks([[1, "e"]], plan).items[0].type, "comparison-seo")
  assert.equal(planItemsFromPicks([[1, "e"]], plan, { ...D, useHeadings: false }).items[0].type, "editorial-originality")
  assert.equal(planItemsFromPicks([[1, "c"]], plan, { ...D, useHeadings: false, useTitleWords: false }).items[0].type, "comparison-seo")
  assert.equal(planItemsFromPicks([[1, "c"]], plan, { ...D, useHeadings: false, useTitleWords: false }).items[0].classificationReason, "AI")
  // Reworded copies: 6 of 7 words shared, merged at "normal", kept apart at "strict". Unsure picks follow keepNeedsReview; ids are stable per line.
  const source = { id: "s1", extractedContent: "Plan\n- Learning culture scale managers onboarding budget wins\n- Learning culture scale managers onboarding budget losses" }
  const keep = planItemsFromPicks([[1, "r"]], source).items[0]
  assert.equal(keep.type, "needs-review")
  assert.equal(planItemsFromPicks([[1, "r"]], source, { ...D, keepNeedsReview: false }).items[0].type, "editorial-originality")
  assert.equal(planItemsFromPicks([[1, "r"]], source).items[0].id, keep.id)
  assert.equal(planItemsFromPicks([[1, "e"], [1, "c"]], source, { ...D, mergeDuplicates: false }).items.length, 1)
  const both = planItemsFromPicks([[1, "e"], [2, "e"]], source).items
  assert.equal(mergeDuplicateTopics(both).length, 1)
  assert.equal(mergeDuplicateTopics(both, { ...D, mergeDuplicates: false }).length, 2)
  assert.equal(mergeDuplicateTopics(both, { ...D, duplicateSensitivity: "strict" }).length, 2)
  // The edited prompt replaces the rules; the answer format and the lines are always appended.
  const custom = { ...D, rulesPrompt: "Only lines under Wave 3 are articles." }
  assert.equal(classifierPrompt("1| A", custom), `Only lines under Wave 3 are articles.\n\n${CLASSIFIER_ANSWER_FORMAT}\n\n1| A`)
  assert.match(classifierPrompt("1| A"), /^Each line below starts with its line number/)
  assert.notDeepEqual(promptSettingsOf(custom), promptSettingsOf(D))
})

test("default heading words match the v3 rules, and * means any letters", async () => {
  const { compileRules } = await import("./contentPlanClassifier.ts")
  const r = compileRules()
  for (const h of ["Comparison topics", "Comparative guides", "Comparing LMS tools", "So sánh công cụ", "A vs B", "Versus"]) assert.equal(r.section(h), "comparison-seo", h)
  for (const h of ["Editorial support", "Editorials", "Thought leadership", "Góc nhìn"]) assert.equal(r.section(h), "editorial-originality", h)
  for (const h of ["VSphere setup", "Action Plan", "Priority Topics"]) assert.equal(r.section(h), null, h)
})
