import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import {
  type AgentAccountSummary,
  type AgentAuthAttemptView,
  type AgentAuthChallenge,
  type CliAgentProvider,
  isCliProvider,
  isRemoteAuthProvider,
} from '@/lib/game-agent/providers'
import { agentSettingsFromSyncDocument } from '@/lib/game-agent/settings-sync'
import { clearAgentModelCache } from '@/services/game-agent/model-cache'
import { agentProxyEnv } from '@/services/game-agent/proxy/agent-proxy'
import { type GameAgentProfile, loadGameAgentSyncDocument } from '@/services/game-agent/settings'

import { notifyAgentAuthChange } from '../auth-change.server'
import { acquireCredentialLease, invalidateCredentialLease, waitForCredentialLeaseRelease } from '../credentials/runtime-dir.server'
import { credentialLockFile, type CredentialPaths, deleteCredentials, readCredentialMeta, writeCredentials } from '../credentials/store.server'
import { AgentCliError, isAgentCliError } from '../errors'
import { holdFileLock } from '../file-lock.server'
import { remoteAuthAdapter } from './adapters.server'
import { clearCursorAuthCache, logoutCursor, startCursorLogin } from './cursor-local.server'
import type { AuthAttemptHandle, RemoteAuthAdapter } from './remote-adapter'

type AttemptState = AgentAuthAttemptView['state']

type Attempt = {
  id: string
  profileId: string
  provider: CliAgentProvider
  lockKey: string
  state: AttemptState
  challenge: AgentAuthChallenge | null
  account?: AgentAccountSummary
  error?: { code: string; message: string }
  handle?: AuthAttemptHandle
  abort: AbortController
  stagingDir?: string
  releaseLock?: () => void
  /** Credentials are being stored; cancelling now would leave a half-applied authorization. */
  finalizing: boolean
  idleTimer?: ReturnType<typeof setTimeout>
  overallTimer?: ReturnType<typeof setTimeout>
  waiters: Set<() => void>
}

export type AuthAttemptDeps = {
  loadProfiles: () => GameAgentProfile[]
  remoteAdapter: (provider: Extract<CliAgentProvider, 'codex' | 'claude' | 'gemini'>) => RemoteAuthAdapter
  cursorLogin: (input: { signal: AbortSignal; proxy?: string; proxyHeaders?: Record<string, string> }) => Promise<AuthAttemptHandle>
  cursorLogout: (proxy?: string | { proxy?: string; proxyHeaders?: Record<string, string> }) => Promise<void>
  proxyEnv: (proxy: string | { proxy?: string; proxyHeaders?: Record<string, string> } | undefined) => Promise<Record<string, string>>
  credentialPaths: CredentialPaths
  runtimeRoot?: string
  stagingRoot: string
  challengeTimeoutMs: number
  idleMs: number
  overallMs: number
  retainMs: number
  leaseWaitMs: number
}

const MAX_WAIT_MS = 25_000

function defaultDeps(): AuthAttemptDeps {
  return {
    loadProfiles: () => agentSettingsFromSyncDocument(loadGameAgentSyncDocument()).profiles,
    remoteAdapter: remoteAuthAdapter,
    cursorLogin: startCursorLogin,
    cursorLogout: logoutCursor,
    proxyEnv: agentProxyEnv,
    credentialPaths: {},
    stagingRoot: path.join(DATA_DIR, 'game-agent', 'auth-staging'),
    challengeTimeoutMs: 30_000,
    idleMs: 45_000,
    overallMs: 10 * 60_000,
    retainMs: 60_000,
    leaseWaitMs: 10_000,
  }
}

let deps = defaultDeps()
const attempts = new Map<string, Attempt>()
const byLock = new Map<string, string>()

export function configureAuthAttemptsForTests(overrides: Partial<AuthAttemptDeps> = {}) {
  for (const attempt of attempts.values()) finish(attempt, 'cancelled')
  attempts.clear()
  byLock.clear()
  deps = { ...defaultDeps(), ...overrides }
}

function profileOf(profileId: string) {
  return deps.loadProfiles().find((profile) => profile.id === profileId) || null
}

function view(attempt: Attempt): AgentAuthAttemptView {
  return {
    attemptId: attempt.id,
    profileId: attempt.profileId,
    state: attempt.state,
    challenge: attempt.state === 'pending' ? attempt.challenge : null,
    ...(attempt.account ? { account: attempt.account } : {}),
    ...(attempt.error ? { error: attempt.error } : {}),
  }
}

function errorView(error: unknown) {
  if (isAgentCliError(error)) return { code: error.code, message: error.message }
  return { code: 'AGENT_AUTH_FAILED', message: error instanceof Error ? error.message : String(error) }
}

function finish(attempt: Attempt, state: Exclude<AttemptState, 'pending'>, detail: { error?: unknown; account?: AgentAccountSummary } = {}) {
  if (attempt.state !== 'pending') return
  attempt.state = state
  if (detail.error !== undefined) attempt.error = errorView(detail.error)
  if (detail.account) attempt.account = detail.account
  clearTimeout(attempt.idleTimer)
  clearTimeout(attempt.overallTimer)
  if (state !== 'completed') void attempt.handle?.cancel().catch(() => undefined)
  attempt.abort.abort()
  attempt.releaseLock?.()
  if (attempt.stagingDir) fs.rmSync(attempt.stagingDir, { recursive: true, force: true })
  if (byLock.get(attempt.lockKey) === attempt.id) byLock.delete(attempt.lockKey)
  for (const wake of attempt.waiters) wake()
  attempt.waiters.clear()
  setTimeout(() => attempts.delete(attempt.id), deps.retainMs).unref?.()
}

function touch(attempt: Attempt) {
  if (attempt.state !== 'pending') return
  clearTimeout(attempt.idleTimer)
  attempt.idleTimer = setTimeout(() => {
    if (!attempt.finalizing) finish(attempt, 'cancelled')
  }, deps.idleMs)
  attempt.idleTimer.unref?.()
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout()
        reject(new AgentCliError('AGENT_AUTH_FAILED', '授权服务未在 30 秒内返回登录信息，请稍后重试'))
      }, ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function waitForLeases(profileId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([waitForCredentialLeaseRelease(profileId), new Promise((resolve) => (timer = setTimeout(resolve, deps.leaseWaitMs)))])
  clearTimeout(timer)
}

function readStagedFiles(adapter: RemoteAuthAdapter, stagingDir: string) {
  const files: Record<string, string> = {}
  for (const relPath of adapter.credentialFiles) {
    const value = fs.readFileSync(path.join(stagingDir, relPath), 'utf8')
    if (!value.trim()) throw new AgentCliError('AGENT_AUTH_FAILED', '授权完成但凭证为空，请重试')
    files[relPath] = value
  }
  return files
}

async function complete(attempt: Attempt, account: AgentAccountSummary, adapter?: RemoteAuthAdapter) {
  if (attempt.state !== 'pending') return
  attempt.finalizing = true
  const current = profileOf(attempt.profileId)
  if (!current || current.provider !== attempt.provider) throw new AgentCliError('AGENT_PROFILE_CHANGED', '授权期间该实例已被删除或修改了类型，请刷新后重试')
  if (attempt.provider === 'cursor') {
    clearCursorAuthCache()
    await notifyAgentAuthChange({ provider: 'cursor' })
    clearAgentModelCache(
      deps
        .loadProfiles()
        .filter((profile) => profile.provider === 'cursor')
        .map((profile) => profile.id)
    )
  } else if (isRemoteAuthProvider(attempt.provider) && adapter && attempt.stagingDir) {
    const files = readStagedFiles(adapter, attempt.stagingDir)
    invalidateCredentialLease(attempt.profileId)
    await notifyAgentAuthChange({ profileId: attempt.profileId })
    await waitForLeases(attempt.profileId)
    writeCredentials(attempt.profileId, { provider: attempt.provider, files, account }, deps.credentialPaths)
    clearAgentModelCache([attempt.profileId])
  }
  finish(attempt, 'completed', { account })
}

/** Starts a login (Cursor) or remote authorization and waits until the player-facing challenge is ready. */
export async function startAuthAttempt(profileId: string): Promise<AgentAuthAttemptView> {
  const profile = profileOf(profileId)
  if (!profile) throw new AgentCliError('AGENT_PROFILE_CHANGED', '找不到该 Agent 实例，请刷新后重试')
  if (!isCliProvider(profile.provider)) throw new AgentCliError('AGENT_AUTH_UNAVAILABLE', 'Ollama 实例不需要授权')
  const provider = profile.provider
  const lockKey = provider === 'cursor' ? 'cursor' : `profile:${profileId}`
  const busy = byLock.get(lockKey)
  if (busy && attempts.get(busy)?.state === 'pending') {
    throw new AgentCliError('AGENT_AUTH_IN_PROGRESS', provider === 'cursor' ? '已有 Cursor 登录进行中' : '该实例已有授权进行中')
  }

  const attempt: Attempt = {
    id: randomUUID(),
    profileId,
    provider,
    lockKey,
    state: 'pending',
    challenge: null,
    abort: new AbortController(),
    finalizing: false,
    waiters: new Set(),
  }
  attempts.set(attempt.id, attempt)
  byLock.set(lockKey, attempt.id)

  let adapter: RemoteAuthAdapter | undefined
  try {
    if (provider === 'cursor') {
      attempt.handle = await withTimeout(
        deps.cursorLogin({ signal: attempt.abort.signal, proxy: profile.proxy, proxyHeaders: profile.proxyHeaders }),
        deps.challengeTimeoutMs,
        () => attempt.abort.abort()
      )
    } else {
      adapter = deps.remoteAdapter(provider)
      const releaseLock = holdFileLock(credentialLockFile(profileId, deps.credentialPaths))
      if (!releaseLock) throw new AgentCliError('AGENT_CREDENTIAL_LOCKED', '该实例正在另一个 Chaya 中使用')
      attempt.releaseLock = releaseLock
      fs.mkdirSync(deps.stagingRoot, { recursive: true, mode: 0o700 })
      attempt.stagingDir = fs.mkdtempSync(path.join(deps.stagingRoot, 'stage-'))
      fs.chmodSync(attempt.stagingDir, 0o700)
      const env = await deps.proxyEnv(profile)
      attempt.handle = await withTimeout(adapter.start({ stagingDir: attempt.stagingDir, signal: attempt.abort.signal, env }), deps.challengeTimeoutMs, () => attempt.abort.abort())
    }
  } catch (error) {
    finish(attempt, 'failed', { error })
    attempts.delete(attempt.id)
    throw error
  }

  if (attempt.state !== 'pending') {
    void attempt.handle.cancel().catch(() => undefined)
    throw new AgentCliError('AGENT_AUTH_FAILED', '授权已被取消')
  }
  attempt.challenge = attempt.handle.challenge
  touch(attempt)
  attempt.overallTimer = setTimeout(() => {
    if (!attempt.finalizing) finish(attempt, 'failed', { error: new AgentCliError('AGENT_AUTH_FAILED', '授权超时，请重新发起') })
  }, deps.overallMs)
  attempt.overallTimer.unref?.()
  attempt.handle.completed.then(
    ({ account }) => complete(attempt, account, adapter).catch((error) => finish(attempt, 'failed', { error })),
    (error) => finish(attempt, attempt.state === 'pending' && attempt.abort.signal.aborted ? 'cancelled' : 'failed', { error })
  )
  return view(attempt)
}

function attemptOf(attemptId: string) {
  const attempt = attempts.get(attemptId)
  if (!attempt) throw new AgentCliError('AGENT_AUTH_ATTEMPT_NOT_FOUND', '授权已结束或不存在，请重新发起')
  return attempt
}

export async function getAuthAttempt(attemptId: string, waitMs = 0): Promise<AgentAuthAttemptView> {
  const attempt = attemptOf(attemptId)
  touch(attempt)
  const wait = Math.min(Math.max(0, waitMs), MAX_WAIT_MS)
  if (attempt.state === 'pending' && wait > 0) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, wait)
      function done() {
        clearTimeout(timer)
        attempt.waiters.delete(done)
        resolve()
      }
      attempt.waiters.add(done)
    })
    touch(attempt)
  }
  return view(attempt)
}

export async function submitAuthCode(attemptId: string, code: string): Promise<AgentAuthAttemptView> {
  const attempt = attemptOf(attemptId)
  touch(attempt)
  if (attempt.state !== 'pending') return view(attempt)
  if (!attempt.handle?.submitCode) throw new AgentCliError('AGENT_AUTH_UNAVAILABLE', '该授权方式不需要回填授权码')
  const trimmed = code.trim()
  if (!trimmed || trimmed.length > 4_096) throw new AgentCliError('AGENT_AUTH_FAILED', '授权码无效')
  await attempt.handle.submitCode(trimmed)
  return view(attempt)
}

export function cancelAuthAttempt(attemptId: string): AgentAuthAttemptView {
  const attempt = attemptOf(attemptId)
  if (attempt.state === 'pending' && !attempt.finalizing) finish(attempt, 'cancelled')
  return view(attempt)
}

/**
 * Removes a remote authorization: ends sessions using it, asks the provider to log out (best effort), then deletes
 * the ciphertext. Also used after a profile is deleted or changes type, so it relies on stored metadata only.
 */
export async function logoutProfile(profileId: string): Promise<void> {
  const busy = byLock.get(`profile:${profileId}`)
  if (busy) {
    const attempt = attempts.get(busy)
    if (attempt?.state === 'pending') finish(attempt, 'cancelled')
  }
  const meta = readCredentialMeta(profileId, deps.credentialPaths)
  const profile = profileOf(profileId)
  invalidateCredentialLease(profileId)
  await notifyAgentAuthChange({ profileId })
  await waitForLeases(profileId)
  if (meta?.state === 'active') {
    try {
      const adapter = deps.remoteAdapter(meta.provider)
      if (adapter.logout) {
        const lease = await acquireCredentialLease(profileId, { ...deps.credentialPaths, runtimeRoot: deps.runtimeRoot, extraFiles: adapter.extraFiles() })
        invalidateCredentialLease(profileId)
        try {
          await adapter.logout({ runtimeDir: lease.dir, signal: AbortSignal.timeout(10_000), env: await deps.proxyEnv(profile || undefined) })
        } finally {
          await lease.release()
        }
      }
    } catch {
      /* Provider logout is best effort; the local ciphertext is removed regardless. */
    }
  }
  deleteCredentials(profileId, deps.credentialPaths)
  clearAgentModelCache([profileId])
}

/** Signs out the machine's Cursor CLI; every Cursor profile loses its login, so all of their sessions end first. */
export async function logoutCursorLogin(proxy?: string): Promise<void> {
  const busy = byLock.get('cursor')
  if (busy) {
    const attempt = attempts.get(busy)
    if (attempt?.state === 'pending' && !attempt.finalizing) finish(attempt, 'cancelled')
  }
  await notifyAgentAuthChange({ provider: 'cursor' })
  try {
    await deps.cursorLogout(proxy)
  } finally {
    clearCursorAuthCache()
    clearAgentModelCache(
      deps
        .loadProfiles()
        .filter((profile) => profile.provider === 'cursor')
        .map((profile) => profile.id)
    )
  }
}

/** Deleting a profile or changing its type must not leave its remote authorization behind. */
export function releaseRemovedAuthorizations(before: readonly GameAgentProfile[], after: readonly GameAgentProfile[]) {
  const next = new Map(after.map((profile) => [profile.id, profile.provider]))
  for (const profile of before) {
    if (isRemoteAuthProvider(profile.provider) && next.get(profile.id) !== profile.provider) void logoutProfile(profile.id).catch(() => undefined)
  }
}
