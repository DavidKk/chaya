import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  cancelAuthAttempt,
  configureAuthAttemptsForTests,
  getAuthAttempt,
  logoutCursorLogin,
  logoutProfile,
  startAuthAttempt,
} from '@/services/game-agent/cli/auth/attempts.server'
import type { AuthAttemptHandle, RemoteAuthAdapter } from '@/services/game-agent/cli/auth/remote-adapter'
import { readCredentialMeta, readCredentials, writeCredentials } from '@/services/game-agent/cli/credentials/store.server'
import type { GameAgentProfile } from '@/services/game-agent/settings'

let root: string
let profiles: GameAgentProfile[]
let credentialPaths: { dir: string; keyFile: string }

const profile = (id: string, provider: GameAgentProfile['provider']): GameAgentProfile => ({
  id,
  label: id,
  provider,
  endpoint: '',
  defaultModel: '',
  temperature: 0.2,
  keepAlive: '10m',
  modelRequestTimeoutMs: 10_000,
  modelTimeoutMs: 120_000,
  gameCallTimeoutMs: 15_000,
  proxy: '',
})

function fakeAdapter() {
  const calls = { cancel: 0, logout: 0, stagingDirs: [] as string[], envs: [] as Record<string, string>[] }
  let complete: (account: { emailHint?: string }) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  const adapter: RemoteAuthAdapter = {
    provider: 'codex',
    credentialFiles: ['auth.json'],
    extraFiles: () => ({ 'config.toml': 'x = 1\n' }),
    async start({ stagingDir, env }): Promise<AuthAttemptHandle> {
      calls.stagingDirs.push(stagingDir)
      calls.envs.push(env)
      const completed = new Promise<{ account: { emailHint?: string } }>((resolve, reject) => {
        complete = (account) => {
          fs.writeFileSync(path.join(stagingDir, 'auth.json'), '{"token":"new"}')
          resolve({ account })
        }
        fail = reject
      })
      return {
        challenge: { kind: 'device_code', url: 'https://auth.example/device', userCode: 'ABCD-EFGH', expiresAt: Date.now() + 60_000 },
        completed,
        async cancel() {
          calls.cancel += 1
          fail(new Error('cancelled'))
        },
      }
    },
    async logout() {
      calls.logout += 1
    },
  }
  return { adapter, calls, complete: (account = {}) => complete(account), fail: (error: Error) => fail(error) }
}

function setup(overrides: Parameters<typeof configureAuthAttemptsForTests>[0] = {}) {
  const fake = fakeAdapter()
  configureAuthAttemptsForTests({
    loadProfiles: () => profiles,
    remoteAdapter: () => fake.adapter,
    credentialPaths,
    runtimeRoot: path.join(root, 'runtime'),
    stagingRoot: path.join(root, 'staging'),
    retainMs: 10_000,
    ...overrides,
  })
  return fake
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-attempts-'))
  credentialPaths = { dir: path.join(root, 'credentials'), keyFile: path.join(root, 'secret.key') }
  profiles = [profile('codex-a', 'codex'), profile('cursor-a', 'cursor'), profile('local', 'ollama')]
})

afterEach(() => {
  configureAuthAttemptsForTests()
  fs.rmSync(root, { recursive: true, force: true })
})

test('completing a device-code attempt stores encrypted credentials and clears staging', async () => {
  const fake = setup()
  const started = await startAuthAttempt('codex-a')
  expect(started).toMatchObject({ state: 'pending', challenge: { kind: 'device_code', userCode: 'ABCD-EFGH' } })

  fake.complete({ emailHint: 'p***@example.com' })
  const done = await getAuthAttempt(started.attemptId, 2_000)
  expect(done).toMatchObject({ state: 'completed', challenge: null, account: { emailHint: 'p***@example.com' } })
  expect(readCredentials('codex-a', credentialPaths)?.files['auth.json']).toBe('{"token":"new"}')
  expect(readCredentialMeta('codex-a', credentialPaths)?.account).toEqual({ emailHint: 'p***@example.com' })
  expect(fs.existsSync(fake.calls.stagingDirs[0])).toBe(false)
})

test('remote authorization runs the CLI through the profile proxy', async () => {
  profiles[0] = { ...profiles[0], proxy: 'http://127.0.0.1:7890' }
  const fake = setup()
  await startAuthAttempt('codex-a')
  expect(fake.calls.envs[0]).toMatchObject({ HTTPS_PROXY: 'http://127.0.0.1:7890', https_proxy: 'http://127.0.0.1:7890', NO_PROXY: 'localhost,127.0.0.1,::1' })
})

test('a second attempt for the same profile is rejected while one is pending', async () => {
  setup()
  await startAuthAttempt('codex-a')
  await expect(startAuthAttempt('codex-a')).rejects.toMatchObject({ code: 'AGENT_AUTH_IN_PROGRESS' })
})

test('an attempt nobody polls is cancelled', async () => {
  const fake = setup({ idleMs: 30 })
  const started = await startAuthAttempt('codex-a')
  await new Promise((resolve) => setTimeout(resolve, 80))
  expect((await getAuthAttempt(started.attemptId)).state).toBe('cancelled')
  expect(fake.calls.cancel).toBe(1)
})

test('a profile deleted or retyped during authorization discards the result', async () => {
  const fake = setup()
  const started = await startAuthAttempt('codex-a')
  profiles = [profile('codex-a', 'claude')]
  fake.complete()
  const done = await getAuthAttempt(started.attemptId, 2_000)
  expect(done).toMatchObject({ state: 'failed', error: { code: 'AGENT_PROFILE_CHANGED' } })
  expect(readCredentialMeta('codex-a', credentialPaths)).toBeNull()
})

test('cancelling leaves the previous authorization untouched', async () => {
  setup()
  writeCredentials('codex-a', { provider: 'codex', files: { 'auth.json': '{"token":"old"}' } }, credentialPaths)
  const started = await startAuthAttempt('codex-a')
  expect(cancelAuthAttempt(started.attemptId).state).toBe('cancelled')
  expect(readCredentials('codex-a', credentialPaths)).toMatchObject({ generation: 1, files: { 'auth.json': '{"token":"old"}' } })
})

test('logout asks the provider first and always removes the ciphertext', async () => {
  const fake = setup()
  writeCredentials('codex-a', { provider: 'codex', files: { 'auth.json': '{"token":"old"}' } }, credentialPaths)
  await logoutProfile('codex-a')
  expect(fake.calls.logout).toBe(1)
  expect(readCredentialMeta('codex-a', credentialPaths)).toBeNull()
})

test('Cursor logins share one machine-wide lock across profiles', async () => {
  profiles.push(profile('cursor-b', 'cursor'))
  let cancelled = 0
  setup({
    cursorLogin: async () => ({
      challenge: { kind: 'browser_link', url: 'https://cursor.com/loginDeepControl?x=1', expiresAt: Date.now() + 60_000 },
      completed: new Promise(() => undefined),
      async cancel() {
        cancelled += 1
      },
    }),
  })
  const first = await startAuthAttempt('cursor-a')
  expect(first.challenge).toMatchObject({ kind: 'browser_link' })
  await expect(startAuthAttempt('cursor-b')).rejects.toMatchObject({ code: 'AGENT_AUTH_IN_PROGRESS' })
  cancelAuthAttempt(first.attemptId)
  expect(cancelled).toBe(1)
})

test('Cursor logout cancels a pending login and signs out the machine CLI once', async () => {
  let cancelled = 0
  const logout = jest.fn(async () => undefined)
  setup({
    cursorLogin: async () => ({
      challenge: { kind: 'browser_link', url: 'https://cursor.com/loginDeepControl?x=1', expiresAt: Date.now() + 60_000 },
      completed: new Promise(() => undefined),
      async cancel() {
        cancelled += 1
      },
    }),
    cursorLogout: logout,
  })
  const pending = await startAuthAttempt('cursor-a')
  await logoutCursorLogin()
  expect(logout).toHaveBeenCalledTimes(1)
  expect(cancelled).toBe(1)
  expect((await getAuthAttempt(pending.attemptId)).state).toBe('cancelled')
})

test('Ollama profiles and unknown ids cannot start an authorization', async () => {
  setup()
  await expect(startAuthAttempt('local')).rejects.toMatchObject({ code: 'AGENT_AUTH_UNAVAILABLE' })
  await expect(startAuthAttempt('missing')).rejects.toMatchObject({ code: 'AGENT_PROFILE_CHANGED' })
})
