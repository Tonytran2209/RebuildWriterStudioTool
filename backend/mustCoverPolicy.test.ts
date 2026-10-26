import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMustCoverTopics, missingMustCoverTopics } from '../src/lib/mustCoverPolicy.ts';

const topic = 'Show limitations of choosing a format by appearance alone';
const outline = [
  { id: 'a', heading: 'Animation and Live Action', notes: 'Compare the approaches.', level: 'h2' as const },
  { id: 'b', heading: 'A Practical Format Decision Framework', notes: 'Evaluate options.', level: 'h2' as const },
];

test('new outlines persist missing spec topics in a related section without inventing evidence', () => {
  const mapped = mapMustCoverTopics(outline, [topic]);
  assert.deepEqual(missingMustCoverTopics(mapped, [topic]), []);
  assert.match(mapped[1].notes, /Required coverage: Show limitations/);
  assert.equal(outline[1].notes, 'Evaluate options.');
  assert.deepEqual(mapMustCoverTopics(mapped, [topic]), mapped);
});

test('an existing draft can satisfy a missing outline mapping, but unrelated prose cannot', () => {
  const covered = 'Choosing a format by appearance alone has limitations when the task calls for explaining a process.';
  assert.deepEqual(missingMustCoverTopics(outline, [topic], covered), []);
  assert.deepEqual(missingMustCoverTopics(outline, [topic], 'Animation and live action are two media formats.'), [topic]);
});
