import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { acquireCredentialLease, invalidateCredentialLease, resetCredentialLeasesForTests } from '@/services/game-agent/cli/credentials/runtime-dir.server'
import { credentialFile, credentialLockFile, deleteCredentials, readCredentialMeta, readCredentials, writeCredentials } from '@/services/game-agent/cli/credentials/store.server'
import { holdFileLock } from '@/services/game-agent/cli/file-lock.server'

let root: string
let paths: { dir: string; keyFile: string; runtimeRoot: string }

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cred-'))
  paths = { dir: path.join(root, 'credentials'), keyFile: path.join(root, 'secret.key'), runtimeRoot: path.join(root, 'runtime') }
  resetCredentialLeasesForTests()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const AUTH = JSON.stringify({ tokens: { refresh_token: 'refresh-secret' } })

test('stores credential files as ciphertext bound to profile, provider and path', () => {
  const meta = writeCredentials('codex agent/1', { provider: 'codex', files: { 'auth.json': AUTH }, account: { emailHint: 'p***@example.com' } }, paths)
  expect(meta).toMatchObject({ provider: 'codex', generation: 1, state: 'active', account: { emailHint: 'p***@example.com' } })

  const file = credentialFile('codex agent/1', paths)
  expect(path.basename(file)).toMatch(/^[0-9a-f]{32}\.json$/)
  expect(fs.readFileSync(file, 'utf8')).not.toContain('refresh-secret')
  expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600')
  expect(readCredentials('codex agent/1', paths)?.files['auth.json']).toBe(AUTH)
  expect(readCredentialMeta('codex agent/1', paths)).toMatchObject({ generation: 1 })

  fs.copyFileSync(file, credentialFile('other', paths))
  expect(() => readCredentials('other', paths)).toThrow(/重新授权/)
})

test('rejects credential paths that escape the runtime directory', () => {
  expect(() => writeCredentials('a', { provider: 'codex', files: { '../auth.json': AUTH } }, paths)).toThrow(/路径无效/)
})

test('a write-back from an older generation never overwrites a newer authorization', () => {
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': '{"fresh":true}' } }, paths)
  expect(writeCredentials('a', { provider: 'codex', files: { 'auth.json': '{"stale":true}' }, baseGeneration: 1 }, paths)).toBeNull()
  expect(readCredentials('a', paths)).toMatchObject({ generation: 2, files: { 'auth.json': '{"fresh":true}' } })
})

test('runtime lease writes back only changed files and deletes plaintext on release', async () => {
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)
  const first = await acquireCredentialLease('a', { ...paths, extraFiles: { 'config.toml': 'cli_auth_credentials_store = "file"\n' } })
  const second = await acquireCredentialLease('a', paths)
  expect(second.dir).toBe(first.dir)
  expect(fs.readFileSync(path.join(first.dir, 'config.toml'), 'utf8')).toContain('file')

  await first.sync()
  expect(readCredentialMeta('a', paths)?.generation).toBe(1)

  fs.writeFileSync(path.join(first.dir, 'auth.json'), '{"refreshed":true}')
  await first.release()
  expect(fs.existsSync(first.dir)).toBe(true)
  await second.release()

  expect(fs.existsSync(first.dir)).toBe(false)
  expect(readCredentials('a', paths)).toMatchObject({ generation: 2, files: { 'auth.json': '{"refreshed":true}' } })
  expect(Object.keys(readCredentials('a', paths)!.files)).toEqual(['auth.json'])
})

test('reauthorization during a lease discards the runtime copy', async () => {
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)
  const lease = await acquireCredentialLease('a', paths)
  fs.writeFileSync(path.join(lease.dir, 'auth.json'), '{"old-session":true}')
  invalidateCredentialLease('a')
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': '{"new-login":true}' } }, paths)
  await lease.release()
  expect(readCredentials('a', paths)?.files['auth.json']).toBe('{"new-login":true}')
})

test('a credential file cleared by the CLI marks the authorization expired', async () => {
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)
  const lease = await acquireCredentialLease('a', paths)
  fs.writeFileSync(path.join(lease.dir, 'auth.json'), '')
  await lease.release()
  expect(readCredentialMeta('a', paths)?.state).toBe('expired')
  await expect(acquireCredentialLease('a', paths)).rejects.toMatchObject({ code: 'AGENT_AUTH_EXPIRED' })
})

test('logout during a lease leaves nothing behind', async () => {
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)
  const lease = await acquireCredentialLease('a', paths)
  fs.writeFileSync(path.join(lease.dir, 'auth.json'), '{"refreshed":true}')
  deleteCredentials('a', paths)
  await lease.release()
  expect(readCredentialMeta('a', paths)).toBeNull()
})

test('missing authorization is reported before any directory is created', async () => {
  await expect(acquireCredentialLease('missing', paths)).rejects.toMatchObject({ code: 'AGENT_AUTH_REQUIRED' })
  expect(fs.existsSync(credentialLockFile('missing', paths))).toBe(false)
})

test('a lock held by another live process blocks; a dead owner is taken over', async () => {
  writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)
  const lock = credentialLockFile('a', paths)
  fs.writeFileSync(lock, JSON.stringify({ pid: process.ppid, startedAt: 1 }))
  await expect(acquireCredentialLease('a', paths)).rejects.toMatchObject({ code: 'AGENT_CREDENTIAL_LOCKED' })
  expect(() => writeCredentials('a', { provider: 'codex', files: { 'auth.json': AUTH } }, paths)).toThrow(/另一个 Chaya/)

  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: 1 }))
  const lease = await acquireCredentialLease('a', paths)
  expect(JSON.parse(fs.readFileSync(lock, 'utf8')).pid).toBe(process.pid)
  await lease.release()
  expect(fs.existsSync(lock)).toBe(false)
})

test('file locks are shared by refcount inside one process', () => {
  const file = path.join(root, 'shared.lock')
  const a = holdFileLock(file)!
  const b = holdFileLock(file)!
  a()
  expect(fs.existsSync(file)).toBe(true)
  b()
  expect(fs.existsSync(file)).toBe(false)
})
