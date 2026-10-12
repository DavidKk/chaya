import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { RemoteAuthProvider } from '@/lib/game-agent/providers'

import { AgentCliError } from '../errors'
import { holdFileLock } from '../file-lock.server'
import { credentialLockFile, type CredentialPaths, fileKey, markCredentialsExpired, readCredentials, writeCredentials } from './store.server'

export type CredentialLease = {
  dir: string
  provider: RemoteAuthProvider
  generation: number
  /** Copies refreshed tokens back to the encrypted store; safe to call after every turn. */
  sync: () => Promise<void>
  release: () => Promise<void>
}

export type LeaseOptions = CredentialPaths & {
  runtimeRoot?: string
  /** Non-secret provider config written next to the credentials (Codex `config.toml`, Gemini `settings.json`). */
  extraFiles?: Record<string, string>
}

type LeaseEntry = {
  profileId: string
  dir: string
  provider: RemoteAuthProvider
  paths: CredentialPaths
  baseGeneration: number
  hashes: Map<string, string>
  refs: number
  /** Set once a newer authorization or logout made this copy obsolete; it is never written back again. */
  stale: boolean
  releaseLock: () => void
  queue: Promise<void>
  idle: Array<() => void>
}

const leases = new Map<string, LeaseEntry>()
let cleanedRoots = new Set<string>()

export const CLI_RUNTIME_ROOT = path.join(os.tmpdir(), 'chaya-agent')

/** Empty working directory for a single CLI session; the CLI never sees the game or the repo. */
export function createOnceCwd(root = CLI_RUNTIME_ROOT) {
  const dir = path.join(root, String(process.pid), `once-${randomUUID()}`, 'cwd')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return { dir, remove: () => fs.rmSync(path.dirname(dir), { recursive: true, force: true }) }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Plaintext from a killed Chaya process must not outlive it. */
export function cleanupStaleRuntimeDirs(root = CLI_RUNTIME_ROOT) {
  let entries: string[]
  try {
    entries = fs.readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    const pid = Number(name)
    if (!Number.isInteger(pid) || pid === process.pid || pidAlive(pid)) continue
    fs.rmSync(path.join(root, name), { recursive: true, force: true })
  }
}

function writeFile(dir: string, relPath: string, value: string) {
  const file = path.join(dir, relPath)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, value, { mode: 0o600 })
}

function readRuntimeFile(dir: string, relPath: string) {
  try {
    return fs.readFileSync(path.join(dir, relPath), 'utf8')
  } catch {
    return ''
  }
}

function writeBack(entry: LeaseEntry) {
  if (entry.stale) return
  const files: Record<string, string> = {}
  let changed = false
  for (const [relPath, previous] of entry.hashes) {
    const value = readRuntimeFile(entry.dir, relPath)
    if (!value.trim()) {
      entry.stale = true
      markCredentialsExpired(entry.profileId, entry.baseGeneration, entry.paths)
      return
    }
    files[relPath] = value
    if (hash(value) !== previous) changed = true
  }
  if (!changed) return
  let saved
  try {
    saved = writeCredentials(entry.profileId, { provider: entry.provider, files, baseGeneration: entry.baseGeneration }, entry.paths)
  } catch {
    entry.stale = true
    markCredentialsExpired(entry.profileId, entry.baseGeneration, entry.paths)
    return
  }
  if (!saved) {
    entry.stale = true
    return
  }
  entry.baseGeneration = saved.generation
  for (const [relPath, value] of Object.entries(files)) entry.hashes.set(relPath, hash(value))
}

function enqueue(entry: LeaseEntry, task: () => void) {
  const next = entry.queue.then(task, task)
  entry.queue = next.catch(() => undefined)
  return next
}

function open(profileId: string, options: LeaseOptions): LeaseEntry {
  const root = options.runtimeRoot || CLI_RUNTIME_ROOT
  if (!cleanedRoots.has(root)) {
    cleanedRoots.add(root)
    cleanupStaleRuntimeDirs(root)
  }
  const paths: CredentialPaths = { dir: options.dir, keyFile: options.keyFile }
  const releaseLock = holdFileLock(credentialLockFile(profileId, paths))
  if (!releaseLock) throw new AgentCliError('AGENT_CREDENTIAL_LOCKED', '该实例正在另一个 Chaya 中使用')
  const dir = path.join(root, String(process.pid), `cred-${fileKey(profileId)}`)
  try {
    const stored = readCredentials(profileId, paths)
    if (!stored) throw new AgentCliError('AGENT_AUTH_REQUIRED', '该实例尚未授权，请先在配置页完成授权')
    if (stored.state === 'expired') throw new AgentCliError('AGENT_AUTH_EXPIRED', '该实例的授权已失效，请重新授权')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.chmodSync(dir, 0o700)
    const hashes = new Map<string, string>()
    for (const [relPath, value] of Object.entries(stored.files)) {
      writeFile(dir, relPath, value)
      hashes.set(relPath, hash(value))
    }
    for (const [relPath, value] of Object.entries(options.extraFiles || {})) {
      if (!hashes.has(relPath)) writeFile(dir, relPath, value)
    }
    return { profileId, dir, provider: stored.provider, paths, baseGeneration: stored.generation, hashes, refs: 0, stale: false, releaseLock, queue: Promise.resolve(), idle: [] }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    releaseLock()
    throw error
  }
}

/**
 * One plaintext runtime directory per profile, shared by refcount. The last release writes back and deletes it.
 * A write-back never overwrites a generation newer than the one this copy was taken from.
 */
export async function acquireCredentialLease(profileId: string, options: LeaseOptions = {}): Promise<CredentialLease> {
  let entry = leases.get(profileId)
  if (!entry) {
    entry = open(profileId, options)
    leases.set(profileId, entry)
  }
  entry.refs += 1
  const current = entry
  let released = false
  return {
    dir: current.dir,
    provider: current.provider,
    generation: current.baseGeneration,
    sync: () => enqueue(current, () => writeBack(current)),
    release: async () => {
      if (released) return
      released = true
      current.refs -= 1
      if (current.refs > 0) return
      await enqueue(current, () => {
        if (current.refs > 0) return
        try {
          writeBack(current)
        } finally {
          fs.rmSync(current.dir, { recursive: true, force: true })
          current.releaseLock()
          if (leases.get(profileId) === current) leases.delete(profileId)
          for (const resolve of current.idle.splice(0)) resolve()
        }
      })
    },
  }
}

/** Marks the live copy obsolete so its final release cannot write back over a new authorization or a logout. */
export function invalidateCredentialLease(profileId: string) {
  const entry = leases.get(profileId)
  if (entry) entry.stale = true
}

export function waitForCredentialLeaseRelease(profileId: string): Promise<void> {
  const entry = leases.get(profileId)
  if (!entry) return Promise.resolve()
  return new Promise((resolve) => entry.idle.push(resolve))
}

export function hasCredentialLease(profileId: string) {
  return leases.has(profileId)
}

export function resetCredentialLeasesForTests() {
  leases.clear()
  cleanedRoots = new Set()
}
