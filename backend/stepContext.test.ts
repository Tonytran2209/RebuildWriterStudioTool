import assert from 'node:assert/strict'
import test from 'node:test'
import { selectRelevantContent } from './stepContext.ts'

const section = (heading: string, body: string) => `## ${heading}\n${body} ${'filler text '.repeat(250)}`

test('KB excerpts keep the evidence-rule section next to the sections that match the topic', () => {
  const content = [
    section('Evidence boundary', 'EVIDENCE-RULE only cite named clients with approval.'),
    section('Tanuvu public health', 'TANUVU animation for vaccine education.'),
    section('NYU patient education', 'NYU animation patient education video.'),
    section('Dental clinic', 'DENTAL unrelated story.'),
  ].join('\n\n')
  const kept = selectRelevantContent({ content }, 'patient education animation video')
  assert.match(kept, /EVIDENCE-RULE/)
  assert.match(kept, /NYU animation/)
  assert.doesNotMatch(kept, /DENTAL/)
})

test('a short document is sent whole', () => {
  assert.equal(selectRelevantContent({ content: 'short KB' }, 'anything here'), 'short KB')
})
