import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { startAcpSession } from '@/services/game-agent/cli/acp-session.server'
import { classifyCliError, sanitizeCliText } from '@/services/game-agent/cli/classify-error'
import { AgentCliError } from '@/services/game-agent/cli/errors'
import { cliEnv } from '@/services/game-agent/cli/process.server'

const agent = path.join(__dirname, 'fixtures', 'fake-acp-agent.mjs')
let cwd = ''

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-acp-test-'))
})

afterEach(() => {
  fs.rmSync(cwd, { recursive: true, force: true })
})

function start() {
  return startAcpSession({ file: process.execPath, args: [agent], env: cliEnv(process.execPath), cwd, label: 'Fake ACP' })
}

test('lists models and modes, rejects tool permissions, and refuses client fs access', async () => {
  const session = await start()
  try {
    expect(session.models).toEqual([
      { id: 'default[]', name: 'Auto' },
      { id: 'fast[x=1]', name: 'fast' },
    ])
    expect(session.currentModelId).toBe('default[]')
    expect(session.modeIds).toEqual(['agent', 'ask'])
    await session.setMode('ask')
    await session.setModel('fast[x=1]')
    const result = await session.prompt('回复 OK', { timeoutMs: 5_000 })
    expect(result).toEqual({ text: 'permission=deny;fs=-32601;OK', stopReason: 'end_turn' })
  } finally {
    session.close()
  }
})

test('an unknown model surfaces as AGENT_MODEL_UNAVAILABLE', async () => {
  const session = await start()
  try {
    const error = await session.setModel('nope').catch((caught: unknown) => caught)
    expect(classifyCliError(error, { provider: 'cursor', label: 'Cursor' }).code).toBe('AGENT_MODEL_UNAVAILABLE')
  } finally {
    session.close()
  }
})

test('a prompt that never finishes times out and closes the session', async () => {
  const session = await start()
  const error = await session.prompt('hang', { timeoutMs: 300 }).catch((caught: unknown) => caught)
  expect(error).toMatchObject({ code: 'AGENT_CLI_TIMEOUT' })
  session.close()
})

test('classifier maps login, quota and crash messages by provider', () => {
  expect(classifyCliError(new Error('401 Unauthorized'), { provider: 'cursor', label: 'Cursor' }).code).toBe('AGENT_AUTH_REQUIRED')
  expect(classifyCliError(new Error('token expired'), { provider: 'codex', label: 'Codex' }).code).toBe('AGENT_AUTH_EXPIRED')
  expect(classifyCliError(new Error('You have hit your usage limit'), { provider: 'codex', label: 'Codex' }).code).toBe('AGENT_QUOTA_EXCEEDED')
  expect(classifyCliError(new AgentCliError('AGENT_CLI_CRASHED', 'exited'), { provider: 'codex', label: 'Codex', stderr: 'error: refresh token was revoked' }).code).toBe(
    'AGENT_AUTH_EXPIRED'
  )
  expect(classifyCliError(new AgentCliError('AGENT_CLI_TIMEOUT', 'slow'), { provider: 'codex', label: 'Codex', stderr: '429' }).code).toBe('AGENT_CLI_TIMEOUT')
  expect(classifyCliError(new Error('boom'), { provider: 'cursor', label: 'Cursor' })).toMatchObject({ code: 'AGENT_CLI_CRASHED', message: 'Cursor：boom' })
})

test('CLI messages are stripped of token-shaped strings', () => {
  const text = sanitizeCliText(
    'failed Bearer abc.def-123 sk-proj-ABCDEFGHIJ eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl https://x.test/cb?code=secret&state=1 via proxy http://chaya:hunter2@127.0.0.1:5000'
  )
  expect(text).not.toMatch(/abc\.def|sk-proj|eyJ|secret|hunter2/)
  expect(text).toContain('state=1')
  expect(text).toContain('http://***@127.0.0.1:5000')
})
