import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readOutlineStructures, validateOutlineStructure, requiredHeadingMatches } from '../shared/outlineStructures.ts';
import { outlineReviewInstruction } from '../src/lib/outlineQuality.ts';
import type { Article } from '../src/types/index.ts';

test('real T3 playbook rejects the truncated historical outline and preserves body order', () => {
 const content = readFileSync(new URL('../storage-md/page-type-playbook/playbook-page-type-outlines.md', import.meta.url), 'utf8');
 const catalog = readOutlineStructures([{ id: 'md', name: 'playbook.md', category: 'rules', content }]);
 assert.deepEqual(catalog.errors, []);
 assert.equal(catalog.structures.length, 4);
 const structure = catalog.structures.find(s => s.id === 'fl-t3-comparison')!;
 const sections = structure.requiredHeadings.map(h => ({ ...h, heading: h.heading.replace(/\[X\]/g, 'Motion Graphics').replace(/\[Y\]/g, 'Character Animation').replace(/\[[NM]\]/g, '4').replace(/\[Project\]/g, 'Explainer Video') }));
 assert.deepEqual(validateOutlineStructure(sections, structure), []);
 const truncated = sections.slice(0, 3);
 const errors = validateOutlineStructure(truncated, structure).join('; ');
 assert.match(errors, /Differences/);
 assert.match(errors, /Which One/);
 assert.match(errors, /Partnering/);
 assert.match(errors, /FAQs/);
 assert.ok(validateOutlineStructure([...sections].reverse(), structure).length);
 assert.ok(validateOutlineStructure(sections.map(s => ({ ...s, level: 'h3' })), structure).length);
});
test('heading templates preserve literal punctuation and require nonempty slots', () => {
 assert.equal(requiredHeadingMatches('How Much Does Animation Cost?', 'How Much Does [X] Cost?'), true);
 assert.equal(requiredHeadingMatches('How Much Does Animation Cost!', 'How Much Does [X] Cost?'), false);
 assert.equal(requiredHeadingMatches('Definition extra', 'Definition'), false);
 assert.equal(requiredHeadingMatches('Understanding ', 'Understanding [X]'), false);
});
test('semantic review permits the configured closing and reads frozen introduction settings', () => {
 const instruction = outlineReviewInstruction({ outlineStructure: { id: 'comparison', name: 'Comparison', description: 'Compare', useWhen: 'Compare', outlineInstructions: 'Body only', draftInstructions: 'Never plan Conclusion', requiredHeadings: [], schemaVersion: 1, sourceId: 'md', sourceName: 'md', sourceHash: 'h' }, outline: [], draftFormat: { conclusionHeading: 'Where to Start' }, introductionBudget: { min: 90, max: 110, paragraphs: 2 } } as unknown as Article);
 assert.match(instruction, /CLOSING EXCEPTION.*Where to Start/);
 assert.match(instruction, /exactly 2 short paragraphs of 90–110/);
 assert.doesNotMatch(instruction, /still wins: one paragraph/);
 assert.match(instruction, /not again in reader-outcome/);
});

// Execute the pure budget function extracted from the actual server source without starting its app.
test('parent H2 budgets leave the body allocation for child H3 prose', async () => {
 const { transpileModule } = await import('typescript');
 const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
 const start = source.indexOf('function batchDraftBudget(');
 const end = source.indexOf('function batchFieldBudgetChecks(', start);
 const js = transpileModule(source.slice(start, end), {}).outputText;
 const budget = new Function('introductionBudget', 'DEFAULT_CONCLUSION_HEADING', `${js}; return batchDraftBudget;`)(() => ({ min: 60, max: 85, acceptedMin: 60, acceptedMax: 85, paragraphs: 1 }), 'Conclusion');
 const result = budget([{ id: 'p', heading: 'Understanding', level: 'h2' }, { id: 'c', heading: 'Definition', level: 'h3' }, { id: 'b', heading: 'Decision', level: 'h2' }], 1500);
 assert.equal(result.sections[0].maxWords, 65);
 assert.match(result.sections[0].instruction, /1-3 lead-in/);
 assert.ok(result.sections[1].minWords > result.sections[0].maxWords);
 assert.ok(result.sections[2].minWords > result.sections[0].maxWords);
});
