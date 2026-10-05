import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createGameAgentProfile, deleteGameAgentProfile, listGameAgentProfiles, updateGameAgentProfile } from '@/services/game-agent/profile-tools.server'
import { readGameAgentToken } from '@/services/game-agent/secrets'

function tempFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-agent-profiles-'))
  return {
    settingsFile: path.join(dir, 'settings.json'),
    syncFile: path.join(dir, 'settings.sync.json'),
    secretsFile: path.join(dir, 'secrets.json'),
    keyFile: path.join(dir, 'secret.key'),
  }
}

test('creates, updates, lists and deletes profiles without returning credentials', () => {
  const files = tempFiles()
  const created = createGameAgentProfile({ id: 'flow-local', label: 'Flow Local', endpoint: 'http://127.0.0.1:11434', token: 'private-token' }, files)
  expect(created).toMatchObject({ id: 'flow-local', label: 'Flow Local', hasToken: true })
  expect(created).not.toHaveProperty('token')

  const updated = updateGameAgentProfile('Flow Local', { defaultModel: 'gemma4:latest' }, files)
  expect(updated).toMatchObject({ id: 'flow-local', defaultModel: 'gemma4:latest', hasToken: true })
  expect(readGameAgentToken('flow-local', files)).toBe('private-token')
  expect(JSON.stringify(listGameAgentProfiles(files))).not.toContain('private-token')

  const removed = deleteGameAgentProfile('Flow Local', files)
  expect(removed).toMatchObject({ deleted: { id: 'flow-local', label: 'Flow Local' }, count: 1 })
  expect(readGameAgentToken('flow-local', files)).toBeUndefined()
})

test('keeps at least one Agent configuration', () => {
  const files = tempFiles()
  expect(() => deleteGameAgentProfile('Local Ollama', files)).toThrow('至少需要保留一个 Agent')
})
