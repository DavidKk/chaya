import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { GameSignatureResult, IDENTITY_SIGNATURE_VERSION } from '@/lib/game/identity-signature'
import type { ResolvedGame, SupportedEngine } from '@/lib/game/types'

function canonicalStringify(val: unknown): string {
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val)
  }
  if (Array.isArray(val)) {
    return `[${val.map(canonicalStringify).join(',')}]`
  }
  const keys = Object.keys(val as Record<string, unknown>).sort()
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((val as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

function readHeadBytes(file: string, bytes: number): Buffer | null {
  let fd: number | null = null
  try {
    if (!fs.existsSync(file)) return null
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    if (fd != null) fs.closeSync(fd)
  }
}

function readJsonSafe<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function parseIniValue(iniContent: string, section: string, key: string): string | null {
  const sectionRegex = new RegExp(`\\[${section}\\]([^\\[]*)`, 'i')
  const matchSection = iniContent.match(sectionRegex)
  if (!matchSection) return null
  const lines = matchSection[1].split(/\r?\n/)
  const keyRegex = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'i')
  for (const line of lines) {
    const matchKey = line.match(keyRegex)
    if (matchKey) return matchKey[1].trim()
  }
  return null
}

/** Extract canonical signature components for MV and MZ games */
function computeMvMzSignature(contentRoot: string, projectRoot: string): { title: string; hash: string } {
  const system =
    readJsonSafe<{
      gameTitle?: string
      versionId?: number
      startMapId?: number
      startX?: number
      startY?: number
      editDigest?: string
    }>(path.join(contentRoot, 'data', 'System.json')) || {}

  const rawActors = readJsonSafe<Array<{ id?: number; name?: string; profile?: string }>>(path.join(contentRoot, 'data', 'Actors.json')) || []
  const actors = rawActors
    .filter((a) => a && typeof a === 'object' && a.id != null)
    .slice(0, 8)
    .map((a) => ({ id: a.id, name: a.name || '', profile: a.profile || '' }))

  const pkg =
    readJsonSafe<{ name?: string; title?: string; window?: { title?: string } }>(path.join(contentRoot, 'package.json')) ||
    readJsonSafe<{ name?: string; title?: string; window?: { title?: string } }>(path.join(projectRoot, 'package.json')) ||
    {}

  const title = (system.gameTitle || pkg.title || pkg.window?.title || pkg.name || path.basename(contentRoot)).trim()

  const canonicalPayload = canonicalStringify({
    system: {
      gameTitle: system.gameTitle || '',
      versionId: system.versionId || 0,
      startMapId: system.startMapId || 0,
      startX: system.startX || 0,
      startY: system.startY || 0,
      editDigest: system.editDigest || '',
    },
    actors,
    pkg: {
      name: pkg.name || '',
      title: pkg.title || pkg.window?.title || '',
    },
  })

  const hash = createHash('sha256').update(canonicalPayload, 'utf8').digest('hex')
  return { title, hash }
}

/** Extract canonical signature components for RGSS games (VX / VX Ace) */
function computeRgssSignature(contentRoot: string, projectRoot: string): { title: string; hash: string } {
  let iniTitle = ''
  let iniScripts = ''
  const iniCandidates = [path.join(contentRoot, 'Game.ini'), path.join(projectRoot, 'Game.ini')]
  for (const iniPath of iniCandidates) {
    if (fs.existsSync(iniPath)) {
      try {
        const ini = fs.readFileSync(iniPath, 'utf8')
        iniTitle = parseIniValue(ini, 'Game', 'Title') || ''
        iniScripts = parseIniValue(ini, 'Game', 'Scripts') || ''
        if (iniTitle || iniScripts) break
      } catch {
        /* ignore */
      }
    }
  }

  const systemBuf =
    readHeadBytes(path.join(contentRoot, 'Data', 'System.rvdata2'), 16 * 1024) || readHeadBytes(path.join(contentRoot, 'Data', 'System.rvdata'), 16 * 1024) || Buffer.alloc(0)

  const actorsBuf =
    readHeadBytes(path.join(contentRoot, 'Data', 'Actors.rvdata2'), 8 * 1024) || readHeadBytes(path.join(contentRoot, 'Data', 'Actors.rvdata'), 8 * 1024) || Buffer.alloc(0)

  const title = (iniTitle || path.basename(projectRoot) || path.basename(contentRoot)).trim()

  const hasher = createHash('sha256')
  hasher.update(`rgss:ini:${iniTitle}:${iniScripts}\n`, 'utf8')
  hasher.update(systemBuf)
  hasher.update(actorsBuf)
  const hash = hasher.digest('hex')

  return { title, hash }
}

/** Compute content identity signature for a resolved game */
export function computeGameSignature(resolved: ResolvedGame): GameSignatureResult {
  const engine: SupportedEngine | 'unknown' = resolved.engine || 'unknown'
  let title = ''
  let signature = ''

  if (engine === 'VX' || engine === 'VX Ace' || resolved.kind === 'rgss') {
    const res = computeRgssSignature(resolved.contentRoot, resolved.projectRoot)
    title = res.title
    signature = res.hash
  } else {
    const res = computeMvMzSignature(resolved.contentRoot, resolved.projectRoot)
    title = res.title
    signature = res.hash
  }

  return {
    engine,
    title: title || path.basename(resolved.contentRoot) || '未命名游戏',
    signature,
    signatureVersion: IDENTITY_SIGNATURE_VERSION,
    contentRoot: resolved.contentRoot,
    sampledAt: Date.now(),
  }
}
