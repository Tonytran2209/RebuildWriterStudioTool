import assert from 'node:assert/strict'
import test from 'node:test'
import { removeFilesFromLibrary } from './fileDeletion.ts'

test('deleting Storage documents removes them from the library, every gate and the primary Playbook', () => {
  const files = [{ id: 'a', category: 'rules', storagePath: 'rules/a/a.md' }, { id: 'b', category: 'kb' }, { id: 'c', category: 'rules' }]
  const config = { revision: 3, stepConfigs: { 3: { fileAccess: { rules: ['a', 'c'], kb: ['b'] }, primaryPlaybookId: 'a' }, 4: { fileAccess: { rules: ['c'], kb: [] }, primaryPlaybookId: 'c' } } }
  const result = removeFilesFromLibrary(files, config, ['a', 'b', 'gone'])
  assert.deepEqual(result.files.map(f => f.id), ['c'])
  assert.deepEqual(result.removed.map(f => f.storagePath ?? null), ['rules/a/a.md', null])
  assert.deepEqual(result.missing, ['gone'])
  assert.deepEqual(result.config.stepConfigs[3], { fileAccess: { rules: ['c'], kb: [] } })
  assert.equal(result.config.stepConfigs[4].primaryPlaybookId, 'c', 'other gates keep their Playbook')
  assert.equal(result.config.revision, 4)
  assert.equal(config.stepConfigs[3].primaryPlaybookId, 'a', 'input is not mutated')
})
