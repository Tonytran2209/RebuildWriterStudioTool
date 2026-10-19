import assert from "node:assert/strict"
import test from "node:test"
import { introductionCheck } from "../src/lib/introductionPolicy.ts"

const prose = (count: number) => Array(count).fill("reader").join(" ")
const draft = (intro: string) => `# Article title\n\n${intro}\n\n## First section\n${prose(200)}`

test("accepts both introduction word boundaries without counting title or body", () => {
  for (const count of [60, 85]) assert.equal(introductionCheck(draft(prose(count))).status, "pass")
})
test("rejects under-length and over-length introductions", () => {
  for (const count of [0, 59, 86, 140]) assert.equal(introductionCheck(draft(prose(count))).status, "fail")
})
test("rejects multiple paragraphs even within the word budget", () => {
  assert.equal(introductionCheck(draft(`${prose(35)}\n\n${prose(35)}`)).status, "fail")
})
test("counts visible Markdown anchor text and tolerates soft line wraps and CRLF", () => {
  const intro = `${prose(59)}\n[reader](https://example.com/a-long-url)`
  assert.equal(introductionCheck(draft(intro).replace(/\n/g, "\r\n")).status, "pass")
})
