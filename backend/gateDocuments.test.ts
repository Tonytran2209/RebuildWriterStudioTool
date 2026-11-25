import assert from 'node:assert/strict'
import test from 'node:test'
import { readFrontMatter, resolveGateParameters, ruleRoleOf, storageGroupOf, primaryPlaybookId } from '../shared/gateDocuments.ts'
import { introductionCheck } from '../src/lib/introductionPolicy.ts'
import { compileBackendWorkflowRules } from './workflowRules.ts'

const file = (id: string, name: string, content = '', storageGroup?: string) => ({ id, name, category: 'rules', content, storageGroup })

test('Storage group decides the role a Rules file is sent with; the primary Playbook must be ticked for the Gate', () => {
  const draft = file('draft', '03-draft-and-targeted-review.md')
  const seo = file('seo', '05-seo-geo-eeat-checklist.md')
  const voice = file('voice', '02-brand-voice.md')
  const config = { stepConfigs: { 4: { fileAccess: { rules: ['draft', 'seo', 'voice'] }, primaryPlaybookId: 'draft' } } }
  assert.equal(ruleRoleOf(draft, config, 4), 'PLAYBOOK')
  assert.equal(ruleRoleOf(seo, config, 4), 'STANDARD')
  assert.equal(ruleRoleOf(voice, config, 4), 'VOICE')
  assert.equal(ruleRoleOf(draft, config, 3), 'SUPPORTING_PLAYBOOK')
  assert.equal(storageGroupOf(file('x', 'notes.md', '', 'Standards')), 'Standards')
  assert.equal(primaryPlaybookId({ stepConfigs: { 4: { fileAccess: { rules: [] }, primaryPlaybookId: 'draft' } } }, 4), undefined)
})

test('front matter numbers: primary Playbook, then Standards, then old Settings, then default, clamped', () => {
  assert.deepEqual(readFrontMatter('---\nintroMinWords: 70\nname: text # ignored\nconclusionPercent: 9 # note\n---\n# Body'), { introMinWords: 70, conclusionPercent: 9 })
  assert.deepEqual(readFrontMatter('# no front matter\nintroMinWords: 70'), {})
  const files = [
    file('pb', 'draft.md', '---\nintroMinWords: 70\nintroMaxWords: 50\n---'),
    file('std', 'checklist.md', '---\nintroMinWords: 99\nconclusionPercent: 40\n---', 'Standards'),
  ]
  const config = { stepConfigs: { 4: { fileAccess: { rules: ['pb', 'std'] }, primaryPlaybookId: 'pb' } }, workflowRules: { 'core-idea': { stageOverrides: { 'idea-generation': { parameters: { ideaCount: 5 } } } } } }
  const p = resolveGateParameters(files, config)
  assert.deepEqual(p.introMinWords, { value: 70, source: { kind: 'file', name: 'draft.md' } })
  assert.equal(p.introMaxWords.value, 70, 'max never below min')
  assert.deepEqual(p.conclusionPercent, { value: 12, source: { kind: 'file', name: 'checklist.md' } })
  assert.deepEqual(p.ideaCount, { value: 5, source: { kind: 'settings' } })
  assert.deepEqual(p.keywordCount, { value: 10, source: { kind: 'default' } })
})

test('introduction QC uses the frozen Playbook range, default 60–85', () => {
  const draft = (words: number) => `# T\n\n${'word '.repeat(words)}\n\n## A\n\nBody.`
  assert.equal(introductionCheck(draft(70)).status, 'pass')
  assert.equal(introductionCheck(draft(70), { min: 90, max: 120 }).status, 'fail')
  assert.match(introductionCheck(draft(100), { min: 90, max: 120 }).reason, /90–120/)
})

test('platform contract carries no writing numbers, and a primary Playbook replaces the team note', () => {
  const config = { workflowRules: { draft: { customInstruction: 'TEAM NOTE' } }, stepConfigs: { 4: {} } }
  assert.match(compileBackendWorkflowRules(config, 4, 'batch').systemPrompt, /TEAM NOTE/)
  const withPlaybook = compileBackendWorkflowRules({ ...config, stepConfigs: { 4: { fileAccess: { rules: ['pb'] }, primaryPlaybookId: 'pb' } } }, 4, 'batch').systemPrompt
  assert.doesNotMatch(withPlaybook, /TEAM NOTE|60–85|Parameters=/)
  assert.match(withPlaybook, /PLATFORM CONTRACT/)
})
