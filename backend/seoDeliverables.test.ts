import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specMapFields, slugify, seoMetadataOf, fallbackSchemaTypes } from '../src/lib/specMaps.ts';
import { writerBriefMarkdown } from '../src/lib/writerBrief.ts';
import { qcGroupOf, qcGroupScore } from '../src/lib/qcGroups.ts';

test('specMapFields keeps valid map entries, caps them and drops empty fields', () => {
  const fields = specMapFields({
    pageTypeReason: ' Lists win the SERP. ',
    brandAssets: [{ asset: '120 projects', use: 'proof section' }, { asset: '' }, 'bad'],
    entityMap: [{ name: 'SCORM', attributes: ['standard', 7], related: ['LMS'] }],
    citations: [{ statement: 'X costs Y', source: 'pricing.md', entity: 'F.Learning' }],
    metaDescription: 'm'.repeat(300),
    schemaTypes: [],
  });
  assert.equal(fields.pageTypeReason, 'Lists win the SERP.');
  assert.deepEqual(fields.brandAssets, [{ asset: '120 projects', use: 'proof section' }]);
  assert.deepEqual(fields.entityMap, [{ name: 'SCORM', attributes: ['standard', '7'], related: ['LMS'] }]);
  assert.equal(fields.metaDescription?.length, 200);
  assert.ok(!('schemaTypes' in fields));
  assert.deepEqual(specMapFields(null), {});
});

test('slugify and schema fallback', () => {
  assert.equal(slugify('Best eLearning Companies in 2026: Top Đà Nẵng Studios!'), 'best-elearning-companies-in-2026-top');
  assert.deepEqual(fallbackSchemaTypes({ pageType: 'Company toplist', questions: ['Why?'] }), ['Article', 'ItemList', 'FAQPage']);
  assert.deepEqual(fallbackSchemaTypes({ pageType: 'service page' }), ['Service']);
});

const spec = { version: 1, topic: 'eLearning vendors', primaryQuery: 'elearning companies', secondaryQueries: [], audience: 'L&D leads', market: 'USA', language: 'English', primaryIntent: 'commercial', expectedReaderOutcome: 'Shortlist', winningFormat: 'Listicle', mustCover: ['pricing'], optionalCoverage: [], thesis: 'T', brandPov: 'P', evidence: [], ctaObjective: 'Book a call', internalLinkRequirements: [], pageType: 'toplist', metaDescription: 'Compare elearning companies.', brandAssets: [{ asset: '120 projects', use: 'proof' }], createdAt: '' } as any;

test('seoMetadataOf takes the H1 of the draft and the G1 meta description', () => {
  const meta = seoMetadataOf({ articleSpec: spec, draft: '# Top 10 eLearning Companies\n\nBody', title: 'x' } as any)!;
  assert.equal(meta.title, 'Top 10 eLearning Companies');
  assert.equal(meta.slug, 'elearning-companies');
  assert.deepEqual(meta.schemaTypes, ['Article', 'ItemList']);
  assert.equal(seoMetadataOf({} as any), null);
});

test('writerBriefMarkdown assembles the brief from Spec, outline and metadata', () => {
  const brief = writerBriefMarkdown({ id: 'a', title: 'A', articleSpec: spec, draft: '', outline: [{ id: 's1', heading: 'Pricing', notes: 'Compare models', level: 'h2', evidence: [{ source: 'kb.md', quote: 'Q1' }] }] } as any);
  for (const part of ['# Writer Brief: A', 'Primary query: elearning companies', '- pricing', '**H2 Pricing**: Compare models', 'Evidence (kb.md): "Q1"', '120 projects: proof', 'Slug: /elearning-companies']) assert.ok(brief.includes(part), part);
  assert.ok(!brief.includes('## Reader questions'));
});

test('QC checks map to the five scorecard axes with pass 1 / warning 0.5 / fail 0', () => {
  assert.equal(qcGroupOf('checklist-compliance'), 'brand');
  assert.equal(qcGroupOf('reader-outcome'), 'differentiation');
  assert.equal(qcGroupOf('evidence-support'), 'evidence');
  assert.equal(qcGroupOf('outline-structure'), 'ai');
  assert.equal(qcGroupOf('internal-link-budget'), 'seo');
  assert.equal(qcGroupScore([{ status: 'pass' }, { status: 'warning' }, { status: 'fail' }, { status: 'pass' }]), 63);
  assert.equal(qcGroupScore([]), 0);
});
