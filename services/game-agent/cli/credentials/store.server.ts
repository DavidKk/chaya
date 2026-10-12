import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import type { AgentAccountSummary, RemoteAuthProvider } from '@/lib/game-agent/providers'
import { isRemoteAuthProvider } from '@/lib/game-agent/providers'
import { decryptGameAgentSecret, encryptGameAgentSecret, type GameAgentCipherText, loadGameAgentSecretKey } from '@/services/game-agent/secrets'

import { AgentCliError } from '../errors'
import { holdFileLock } from '../file-lock.server'

export type CredentialState = 'active' | 'expired'

type CredentialDocument = {
  version: 1
  provider: RemoteAuthProvider
  generation: number
  account: AgentAccountSummary
  updatedAt: number
  state: CredentialState
  files: Record<string, GameAgentCipherText>
}

export type CredentialMeta = Omit<CredentialDocument, 'version' | 'files'>
export type CredentialPaths = { dir?: string; keyFile?: string }

export const GAME_AGENT_CREDENTIALS_DIR = path.join(DATA_DIR, 'game-agent', 'credentials')

const metaCache = new Map<string, { mtimeMs: number; meta: CredentialMeta | null }>()

function dirOf(paths: CredentialPaths = {}) {
  return paths.dir || GAME_AGENT_CREDENTIALS_DIR
}

/** Profile ids are free text; hashing keeps them out of file names. */
export function fileKey(profileId: string) {
  return createHash('sha256').update(profileId).digest('hex').slice(0, 32)
}

export function credentialFile(profileId: string, paths: CredentialPaths = {}) {
  return path.join(dirOf(paths), `${fileKey(profileId)}.json`)
}

export function credentialLockFile(profileId: string, paths: CredentialPaths = {}) {
  return path.join(dirOf(paths), `${fileKey(profileId)}.lock`)
}

function aad(profileId: string, provider: RemoteAuthProvider, relPath: string) {
  return `cred:${profileId}:${provider}:${relPath}`
}

function assertRelPath(relPath: string) {
  if (!relPath || path.isAbsolute(relPath) || relPath.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`凭证文件路径无效：${relPath}`)
  }
}

function readDocument(file: string): CredentialDocument | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const value = JSON.parse(raw) as CredentialDocument
  if (value?.version !== 1 || !isRemoteAuthProvider(value.provider) || !Number.isInteger(value.generation) || !value.files || typeof value.files !== 'object') {
    throw new Error('Agent 授权文件格式无效')
  }
  return value
}

function writeDocument(file: string, value: CredentialDocument) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temp, file)
    fs.chmodSync(file, 0o600)
  } finally {
    fs.rmSync(temp, { force: true })
  }
  metaCache.delete(file)
}

function metaOf(document: CredentialDocument): CredentialMeta {
  const { provider, generation, account, updatedAt, state } = document
  return { provider, generation, account, updatedAt, state }
}

/** Status reads never decrypt; the stat-keyed cache keeps the 2-second status poll off the parser. */
export function readCredentialMeta(profileId: string, paths: CredentialPaths = {}): CredentialMeta | null {
  const file = credentialFile(profileId, paths)
  let mtimeMs: number
  try {
    mtimeMs = fs.statSync(file).mtimeMs
  } catch {
    metaCache.delete(file)
    return null
  }
  const cached = metaCache.get(file)
  if (cached && cached.mtimeMs === mtimeMs) return cached.meta
  let meta: CredentialMeta | null = null
  try {
    const document = readDocument(file)
    meta = document && metaOf(document)
  } catch {
    meta = null
  }
  metaCache.set(file, { mtimeMs, meta })
  return meta
}

export type DecryptedCredentials = { provider: RemoteAuthProvider; generation: number; state: CredentialState; files: Record<string, string> }

export function readCredentials(profileId: string, paths: CredentialPaths = {}): DecryptedCredentials | null {
  const document = readDocument(credentialFile(profileId, paths))
  if (!document) return null
  const key = loadGameAgentSecretKey(paths.keyFile)
  const files: Record<string, string> = {}
  for (const [relPath, cipher] of Object.entries(document.files)) {
    assertRelPath(relPath)
    try {
      files[relPath] = decryptGameAgentSecret(cipher, aad(profileId, document.provider, relPath), key)
    } catch {
      throw new AgentCliError('AGENT_AUTH_EXPIRED', '该实例的授权无法解密，请重新授权')
    }
  }
  return { provider: document.provider, generation: document.generation, state: document.state, files }
}

export type CredentialWrite = {
  provider: RemoteAuthProvider
  files: Record<string, string>
  account?: AgentAccountSummary
  /** Write-back from a runtime copy: skipped when a newer authorization landed after the copy was taken. */
  baseGeneration?: number
}

function withFileLock<T>(profileId: string, paths: CredentialPaths, run: () => T): T {
  const release = holdFileLock(credentialLockFile(profileId, paths))
  if (!release) throw new AgentCliError('AGENT_CREDENTIAL_LOCKED', '该实例正在另一个 Chaya 中使用')
  try {
    return run()
  } finally {
    release()
  }
}

/** Returns the stored metadata, or null when a write-back lost to a newer authorization. */
export function writeCredentials(profileId: string, input: CredentialWrite, paths: CredentialPaths = {}): CredentialMeta | null {
  return withFileLock(profileId, paths, () => {
    const file = credentialFile(profileId, paths)
    const current = readDocument(file)
    if (input.baseGeneration !== undefined && current && (current.generation > input.baseGeneration || current.provider !== input.provider)) return null
    if (input.baseGeneration !== undefined && !current) return null
    const key = loadGameAgentSecretKey(paths.keyFile)
    const files: Record<string, GameAgentCipherText> = {}
    for (const [relPath, value] of Object.entries(input.files)) {
      assertRelPath(relPath)
      files[relPath] = encryptGameAgentSecret(value, aad(profileId, input.provider, relPath), key)
    }
    const document: CredentialDocument = {
      version: 1,
      provider: input.provider,
      generation: (current?.generation || 0) + 1,
      account: input.account || (current?.provider === input.provider ? current.account : {}),
      updatedAt: Date.now(),
      state: 'active',
      files,
    }
    writeDocument(file, document)
    return metaOf(document)
  })
}

export function markCredentialsExpired(profileId: string, baseGeneration: number, paths: CredentialPaths = {}) {
  withFileLock(profileId, paths, () => {
    const file = credentialFile(profileId, paths)
    const current = readDocument(file)
    if (!current || current.generation > baseGeneration || current.state === 'expired') return
    writeDocument(file, { ...current, state: 'expired', updatedAt: Date.now() })
  })
}

export function deleteCredentials(profileId: string, paths: CredentialPaths = {}) {
  const file = credentialFile(profileId, paths)
  fs.rmSync(file, { force: true })
  metaCache.delete(file)
}
