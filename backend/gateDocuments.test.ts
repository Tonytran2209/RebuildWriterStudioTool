import assert from 'node:assert/strict'
import test from 'node:test'
import { gateBrandContextDocs, gateStandardsDocs, kbRoleOf, primaryPlaybookId, ruleRoleOf, storageGroupInfo } from '../shared/gateDocuments.ts'
import { legacyGateNumbers, readFrontMatter, resolveGateSettings, sanitizeGateSettings } from '../shared/gateSettings.ts'
import { introductionCheck, introductionInstruction } from '../src/lib/introductionPolicy.ts'
import { deterministicQualityChecks } from '../src/lib/universalQuality.ts'
import { step4ChecklistDocs, checklistReviewInstruction } from '../src/lib/qualityPolicy.ts'
import { gateReviewHash, gateReviewStatus } from '../src/lib/gateReview.ts'
import { compileBackendWorkflowRules } from './workflowRules.ts'
import { migrateGateDocuments } from './gateMigration.ts'
import { anthropicSystem } from './providers.ts'
import { applyOutlineFix, applySpecFix } from './gateReviewFix.ts'

const file = (id: string, name: string, content = '', storageGroup?: string) => ({ id, name, category: 'rules', content, storageGroup })
const kb = (id: string, name: string, type?: string, content = 'text') => ({ id, name, category: 'kb', content, ...(type ? { knowledgeMetadata: { type } } : {}) })

test('four Storage groups: Voice & Style is Standards, a group without a saved value is marked guessed', () => {
  assert.deepEqual(storageGroupInfo(file('v', 'notes.md', '', 'Voice & Style')), { group: 'Standards', guessed: false })
  assert.deepEqual(storageGroupInfo(file('b', '02-brand-voice.md')), { group: 'Standards', guessed: true })
  assert.deepEqual(storageGroupInfo(file('p', '03-draft.md')), { group: 'Playbooks', guessed: true })
  assert.deepEqual(storageGroupInfo(file('s', 'x.md', '', 'Playbooks')), { group: 'Playbooks', guessed: false })
  assert.equal(storageGroupInfo(kb('k', 'priority topics.md')).group, 'Source data')
  assert.equal(storageGroupInfo({ ...kb('k', 'priority topics.md'), storageGroup: 'Domain Knowledge' }).group, 'Domain Knowledge')
})

test('roles: primary Playbook must be ticked; Brand context types are sent whole, other knowledge is Evidence', () => {
  const config = { stepConfigs: { 4: { fileAccess: { rules: ['draft', 'seo'], kb: ['pos', 'case'] }, primaryPlaybookId: 'draft' } } }
  assert.equal(ruleRoleOf(file('draft', '03-draft.md'), config, 4), 'PLAYBOOK')
  assert.equal(ruleRoleOf(file('draft', '03-draft.md'), config, 3), 'SUPPORTING_PLAYBOOK')
  assert.equal(ruleRoleOf(file('seo', '05-seo-checklist.md'), config, 4), 'STANDARD')
  assert.equal(primaryPlaybookId({ stepConfigs: { 4: { fileAccess: { rules: [] }, primaryPlaybookId: 'draft' } } }, 4), undefined)
  assert.equal(kbRoleOf(kb('pos', 'positioning.md', 'positioning')), 'BRAND_CONTEXT')
  assert.equal(kbRoleOf(kb('voice', 'vocab.md', 'brand_voice')), 'BRAND_CONTEXT')
  assert.equal(kbRoleOf(kb('case', 'cases.md', 'case_study')), 'KNOWLEDGE_BASE')
  assert.equal(kbRoleOf(kb('plain', 'notes.md')), 'KNOWLEDGE_BASE')
})

test('the G3 review checks Standards only and gets Brand context without internal file names', () => {
  const files = [file('draft', '03-draft.md', 'Write well.'), file('seo', '05-seo-checklist.md', 'Must cite.'), file('struct', '06-structures.md', 'x', 'Standards'), kb('pos', 'secret-positioning.md', 'positioning', 'We are X.'), kb('case', 'cases.md', 'case_study')]
  const config = { stepConfigs: { 4: { fileAccess: { rules: ['draft', 'seo', 'struct'], kb: ['pos', 'case'] } } } }
  assert.deepEqual(step4ChecklistDocs(files, config, { outlineStructure: { sourceId: 'struct' } as any }).map(d => d.name), ['05-seo-checklist.md'])
  assert.deepEqual(gateStandardsDocs(files, config, 3), [])
  const brand = gateBrandContextDocs(files, config, 4)
  assert.deepEqual(brand, [{ name: 'Brand context 1', content: 'We are X.' }])
  const instruction = checklistReviewInstruction(step4ChecklistDocs(files, config, {}), brand)
  assert.match(instruction, /GATE STANDARDS CONTRACT[\s\S]*Must cite\.[\s\S]*BRAND CONTEXT[\s\S]*We are X\./)
  assert.doesNotMatch(instruction, /Write well|secret-positioning/)
  assert.match(checklistReviewInstruction([], []), /No Standards assigned/)
})

test('gate settings: saved values are clamped, unknown keys dropped, defaults fill the rest', () => {
  assert.deepEqual(sanitizeGateSettings({ introMinWords: '999', ideaCount: 4.6, conclusionHeading: '## Where\nto Start ', titleKeyword: 'no', bogus: 1 }), { introMinWords: 150, ideaCount: 5, conclusionHeading: 'Where to Start', titleKeyword: true })
  const values = resolveGateSettings({ gateSettings: { introMinWords: 120, introMaxWords: 90, specSelfReview: true } })
  assert.equal(values.introMaxWords, 120, 'max never below min')
  assert.equal(values.specSelfReview, true)
  assert.equal(values.outlineSelfReview, false)
  assert.equal(values.draftFixRounds, 1)
  assert.equal(values.conclusionHeading, 'Conclusion')
  assert.equal(resolveGateSettings(null).promptCache, true)
})

test('migration: Voice & Style becomes Standards, vocabulary becomes Brand context, v1 numbers are kept once', () => {
  assert.deepEqual(readFrontMatter('---\nintroMinWords: 70\nname: text\n---\n# Body'), { introMinWords: 70 })
  const files = [
    file('pb', '03-draft.md', '---\nintroMinWords: 70\n---'),
    file('voice', '02-brand-voice.md'),
    file('saved', 'tone.md', '', 'Voice & Style'),
    file('check', 'style-checklist.md'),
    kb('vocab', 'Vocabulary Library.md'),
  ]
  const config = { revision: 4, stepConfigs: { 4: { fileAccess: { rules: ['pb'] }, primaryPlaybookId: 'pb' } }, workflowRules: { 'core-idea': { stageOverrides: { 'idea-generation': { parameters: { ideaCount: 5 } } } } }, gateSettings: { ideaCount: 2 } }
  assert.deepEqual(legacyGateNumbers(files, config), { ideaCount: 5, introMinWords: 70 })
  const result = migrateGateDocuments(files, config)!
  assert.deepEqual(result.changedFiles.map(f => f.id), ['voice', 'saved', 'vocab'])
  assert.equal(result.files.find(f => f.id === 'check')!.storageGroup, undefined, 'a checklist was already Standards in v1')
  assert.equal(result.files.find(f => f.id === 'vocab')!.knowledgeMetadata!.type, 'brand_voice')
  assert.deepEqual(result.config.gateSettings, { ideaCount: 2, introMinWords: 70 }, 'a value the admin saved wins')
  assert.equal(migrateGateDocuments(result.files, result.config), null, 'runs once')
})

test('introduction: paragraph count from Settings; the default contract text is unchanged', () => {
  const draft = (paragraphs: string[]) => `# T\n\n${paragraphs.join('\n\n')}\n\n## A\n\nBody.`
  const words = (n: number) => 'word '.repeat(n).trim()
  assert.equal(introductionCheck(draft([words(70)])).status, 'pass')
  assert.equal(introductionCheck(draft([words(35), words(35)])).status, 'fail')
  assert.equal(introductionCheck(draft([words(35), words(35)]), { min: 60, max: 85, paragraphs: 2 }).status, 'pass')
  assert.match(introductionInstruction(), /^INTRODUCTION CONTRACT \(overrides percentage budgets and legacy introduction rules\): Write one compact paragraph of 60–85 English words, ideally 3–4 concise sentences, aiming for approximately 5–6 desktop reading lines\./)
  assert.match(introductionInstruction({ min: 60, max: 85, paragraphs: 2 }), /exactly 2 short paragraphs of 60–85 English words in total/)
})

test('draft format frozen on the article: custom conclusion heading, H1 keyword check can be turned off', () => {
  const article: any = { articleSpec: { primaryQuery: 'medical animation', mustCover: [] }, outline: [{ id: 's1', heading: 'A', level: 'h2' }], keywords: 'medical animation' }
  const text = `# Guide\n\n${'word '.repeat(70)}\n\n## A\n\nmedical animation body.\n\n## Where to Start\n\nEnd.`
  const ids = (a: any) => Object.fromEntries(deterministicQualityChecks(a, text, 1500).filter(c => ['single-conclusion', 'title-keyword'].includes(c.id)).map(c => [c.id, c.status]))
  assert.deepEqual(ids(article), { 'single-conclusion': 'fail', 'title-keyword': 'fail' })
  assert.deepEqual(ids({ ...article, draftFormat: { conclusionHeading: 'Where to Start', titleKeyword: false } }), { 'single-conclusion': 'pass' })
})

test('platform contract carries no writing numbers, and a primary Playbook replaces the team note', () => {
  const config = { workflowRules: { draft: { customInstruction: 'TEAM NOTE' } }, stepConfigs: { 4: {} } }
  assert.match(compileBackendWorkflowRules(config, 4, 'batch').systemPrompt, /TEAM NOTE/)
  const withPlaybook = compileBackendWorkflowRules({ ...config, stepConfigs: { 4: { fileAccess: { rules: ['pb'] }, primaryPlaybookId: 'pb' } } }, 4, 'batch').systemPrompt
  assert.doesNotMatch(withPlaybook, /TEAM NOTE|60–85|Parameters=/)
  assert.match(withPlaybook, /PLATFORM CONTRACT/)
})

test('Anthropic prompt cache: two system blocks that join to the uncached prompt, breakpoint after the shared documents', () => {
  const req = { systemPrompt: 'SYSTEM', contextDocs: ['CONTRACT', 'PLAYBOOK', 'EVIDENCE'], cacheableContextDocs: 2 }
  const plain = anthropicSystem({ ...req, promptCache: false }) as string
  const blocks = anthropicSystem({ ...req, promptCache: true }) as Array<{ text: string; cache_control?: unknown }>
  assert.equal(typeof plain, 'string')
  assert.equal(blocks.map(b => b.text).join(''), plain)
  assert.deepEqual(blocks[0].cache_control, { type: 'ephemeral' })
  assert.match(blocks[0].text, /PLAYBOOK$/)
  assert.equal(blocks[1].cache_control, undefined)
  assert.match(blocks[1].text, /EVIDENCE/)
  assert.equal(anthropicSystem({ promptCache: true }), undefined)
})

test('G1/G2 fixes change wording only and never break the outline', () => {
  const article: any = {
    selectedCoreIdeaId: 'i1', coreIdeaSuggestions: [{ id: 'i1', title: 'Old', primaryKeyword: 'kw', secondaryKeywords: ['a'] }, { id: 'i2', title: 'Other' }],
    articleSpec: { thesis: 'old', primaryQuery: 'kw', mustCover: ['Topic'], evidence: [{ source: 's', quote: 'q' }] },
    outline: [{ id: 's1', heading: 'One', level: 'h2', evidence: [{ quote: 'q' }] }, { id: 's2', heading: 'Two', level: 'h3' }],
  }
  const spec = applySpecFix(article, { idea: { title: 'New', primaryKeyword: 'changed' }, articleSpec: { thesis: 'new', mustCover: ['Include the keyword in the title', 'Real topic'] } })
  assert.equal(spec.title, 'New')
  assert.equal(spec.coreIdeaSuggestions[0].primaryKeyword, 'kw', 'keywords never change')
  assert.equal(spec.coreIdeaSuggestions[1].title, 'Other')
  assert.deepEqual(spec.articleSpec.mustCover, ['Real topic'], 'writing instructions are dropped from mustCover')
  assert.deepEqual(spec.articleSpec.evidence, article.articleSpec.evidence)
  const outline = applyOutlineFix(article, { sections: [{ id: 's2', heading: 'Better two', notes: 'n' }, { id: 'new', heading: 'Added' }] })!
  assert.deepEqual(outline.map((s: any) => [s.id, s.heading, s.level]), [['s1', 'One', 'h2'], ['s2', 'Better two', 'h3']])
  assert.deepEqual(outline[0].evidence, [{ quote: 'q' }])
  assert.equal(applyOutlineFix(article, { sections: [{ id: 's2', heading: 'One' }] }), null, 'duplicate headings are rejected')
  const required = { ...article, outlineStructure: { requiredHeadings: [{ heading: 'One', level: 'h2' }] } }
  assert.equal(applyOutlineFix(required, { sections: [{ id: 's1', heading: 'Renamed' }] }), null, 'a required heading cannot be renamed away')
})

test('a saved review is stale once the reviewed output changes', () => {
  const article: any = { outline: [{ id: 's1', heading: 'One', level: 'h2' }] }
  const hash = gateReviewHash(article, 3)
  assert.equal(gateReviewHash({ ...article, outline: [{ ...article.outline[0], evidence: [{ q: 1 }] }] }, 3), hash, 'evidence is not part of the review')
  assert.notEqual(gateReviewHash({ outline: [{ ...article.outline[0], heading: 'Two' }] }, 3), hash)
  assert.equal(gateReviewStatus([{ item: 'x', status: 'warning', reason: '' }]), 'warning')
  assert.equal(gateReviewStatus([]), 'pass')
})
