import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'

type CipherText = { iv: string; tag: string; data: string }
type SecretDocument = { version: 1; tokens: Record<string, CipherText> }

export type GameAgentSecretFiles = { secretsFile?: string; keyFile?: string }

export const GAME_AGENT_SECRETS_PATH = path.join(DATA_DIR, 'game-agent', 'secrets.json')
export const GAME_AGENT_SECRET_KEY_PATH = path.join(DATA_DIR, 'game-agent', 'secret.key')

function files(input: GameAgentSecretFiles = {}) {
  return { secretsFile: input.secretsFile || GAME_AGENT_SECRETS_PATH, keyFile: input.keyFile || GAME_AGENT_SECRET_KEY_PATH }
}

function ensureKey(file: string): Buffer {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, randomBytes(32).toString('base64'), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64')
  if (key.length !== 32) throw new Error('Agent 凭证密钥无效')
  return key
}

function readDocument(file: string): SecretDocument {
  try {
    if (!fs.existsSync(file)) return { version: 1, tokens: {} }
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as SecretDocument
    if (value?.version !== 1 || !value.tokens || typeof value.tokens !== 'object' || Array.isArray(value.tokens)) throw new Error('Agent 凭证文件格式无效')
    return value
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Agent 凭证文件不是有效的 JSON')
    throw error
  }
}

function writeDocument(file: string, value: SecretDocument) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temp, file)
    fs.chmodSync(file, 0o600)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

function encrypt(value: string, profileId: string, key: Buffer): CipherText {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(profileId))
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
}

function decrypt(value: CipherText, profileId: string, key: Buffer): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'))
    decipher.setAAD(Buffer.from(profileId))
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error(`Agent ${profileId} 的凭证无法解密`)
  }
}

export function hasGameAgentToken(profileId: string, input: GameAgentSecretFiles = {}): boolean {
  return !!readDocument(files(input).secretsFile).tokens[profileId]
}

export function readGameAgentToken(profileId: string, input: GameAgentSecretFiles = {}): string | undefined {
  const resolved = files(input)
  const stored = readDocument(resolved.secretsFile).tokens[profileId]
  return stored ? decrypt(stored, profileId, ensureKey(resolved.keyFile)) : undefined
}

/** Write-only credential update. Passing an empty token removes the stored credential. */
export function saveGameAgentToken(profileId: string, token: string | null, input: GameAgentSecretFiles = {}): boolean {
  const resolved = files(input)
  const document = readDocument(resolved.secretsFile)
  const normalized = token?.trim() || ''
  if (normalized) document.tokens[profileId] = encrypt(normalized, profileId, ensureKey(resolved.keyFile))
  else delete document.tokens[profileId]
  writeDocument(resolved.secretsFile, document)
  return !!normalized
}

export function deleteGameAgentToken(profileId: string, input: GameAgentSecretFiles = {}) {
  const resolved = files(input)
  if (!fs.existsSync(resolved.secretsFile)) return
  const document = readDocument(resolved.secretsFile)
  if (!(profileId in document.tokens)) return
  delete document.tokens[profileId]
  writeDocument(resolved.secretsFile, document)
}
