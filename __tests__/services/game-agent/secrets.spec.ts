import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { hasGameAgentToken, readGameAgentToken, saveGameAgentToken } from '@/services/game-agent/secrets'

test('encrypts Agent tokens at rest and only exposes presence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-agent-secret-'))
  const files = { secretsFile: path.join(dir, 'secrets.json'), keyFile: path.join(dir, 'secret.key') }

  expect(saveGameAgentToken('flow-local', 'super-secret-token', files)).toBe(true)
  expect(hasGameAgentToken('flow-local', files)).toBe(true)
  expect(readGameAgentToken('flow-local', files)).toBe('super-secret-token')
  expect(fs.readFileSync(files.secretsFile, 'utf8')).not.toContain('super-secret-token')
  expect(fs.readFileSync(files.keyFile, 'utf8')).not.toContain('super-secret-token')

  expect(saveGameAgentToken('flow-local', null, files)).toBe(false)
  expect(hasGameAgentToken('flow-local', files)).toBe(false)
  expect(readGameAgentToken('flow-local', files)).toBeUndefined()
})
