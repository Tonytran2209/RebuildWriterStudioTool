import assert from "node:assert/strict"
import test from "node:test"
import { formatDraftExport } from "./draftFormatter.ts"
import { normalizeDraftOutput, normalizeDraftHtml } from "../src/lib/draftExport.ts"

test("normalizes exports while preserving Markdown and original source", () => {
  const source = '# Title — example\n\nIntro — detail.\n\n## Body — section\n**Bold** and *italic* [link](https://example.com/page).\n\n- Item — detail\n\n1. First'
  const result = formatDraftExport(source, 'Title — example', [{ heading: 'Body — section', level: 'h2' }])
  assert.equal(result.markdown, source.replace(/—/g, '-'))
  assert.ok(!result.html.includes('—'))
  for (const tag of ['<h1>', '<h2>', '<strong>', '<em>', '<a href="https://example.com/page">', '<ul>', '<ol>']) assert.ok(result.html.includes(tag), tag)
  assert.ok(source.includes('—'))
  assert.equal(result.aiCalls, 0)
})

test("renders tables with alignment, escaped pipes and inline formatting", () => {
  const result = formatDraftExport('# Table\n\n| Name | Description |\n| :--- | ---: |\n| **A — B** | [Link](https://example.com) |\n| C \\| D | <script>alert(1)</script> |\n\n## After\nUnchanged.', 'Table')
  assert.match(result.html, /<table /)
  assert.match(result.html, /<thead>/)
  assert.match(result.html, /text-align:right/)
  assert.match(result.html, /<strong>A - B<\/strong>/)
  assert.match(result.html, /C \| D/)
  assert.match(result.html, /&lt;script&gt;/)
  assert.ok(!result.html.includes('<script>'))
  assert.match(result.html, /<\/tbody><\/table><h2>After<\/h2>/)
  assert.equal((result.html.match(/<tr>/g) ?? []).length, 3)
})

test("supports tables without outer pipes and does not mistake prose for a table", () => {
  assert.match(formatDraftExport('A | B\n--- | ---\nX | Y', '').html, /<table /)
  assert.ok(!formatDraftExport('A | B\nordinary prose', '').html.includes('<table'))
})

test("normalizes literal and HTML-encoded em dashes without altering other punctuation", () => {
  assert.equal(normalizeDraftOutput('A — B – C - D'), 'A - B – C - D')
  assert.equal(normalizeDraftHtml('<p>— &mdash; &#8212; &#x2014; &amp;</p>'), '<p>- - - - &amp;</p>')
})
