/**
 * Disk-backed RGSS Data source-key index (signature → keys).
 * Shared by seed filter and list extract warm path.
 * @see docs/translation-mainthread-offload.md §3.3.5
 */
import fs from 'node:fs'
import path from 'node:path'

import { ensureGameContentDir, localGameContentFile } from '@/lib/game/content-files'

export type RgssSourcesIndexFile = {
  signature: string
  sources: string[]
  updatedAt: number
}

export function rgssDataSignature(dataDir: string): string {
  const files = fs
    .readdirSync(dataDir)
    .filter((name) => /\.rvdata2?(?:\.chaya\.bak)?$/i.test(name))
    .sort()
  return JSON.stringify(
    files.map((name) => {
      const stat = fs.statSync(path.join(dataDir, name))
      return [name, stat.size, stat.mtimeMs, stat.ctimeMs]
    })
  )
}

function readIndex(contentRoot: string): RgssSourcesIndexFile | null {
  // Local path only (rgssSourcesIndex is never storage-mounted; avoid accidental IPC helpers).
  const file = localGameContentFile(contentRoot, 'rgssSourcesIndex')
  if (!file) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RgssSourcesIndexFile
    if (!raw || typeof raw.signature !== 'string' || !Array.isArray(raw.sources)) return null
    return raw
  } catch {
    return null
  }
}

export function writeRgssSourcesIndex(contentRoot: string, signature: string, sources: Iterable<string>) {
  const file = ensureGameContentDir(contentRoot, 'rgssSourcesIndex')
  const payload: RgssSourcesIndexFile = {
    signature,
    sources: [...sources],
    updatedAt: Date.now(),
  }
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`)
}

/** Return cached source set when Data signature matches; otherwise null. */
export function peekRgssSourcesIndex(contentRoot: string, dataDir: string): Set<string> | null {
  const signature = rgssDataSignature(dataDir)
  const hit = readIndex(contentRoot)
  if (!hit || hit.signature !== signature) return null
  return new Set(hit.sources)
}

/** Build or reuse disk index. `build` runs only on miss (sync loadRgssItems). */
export function ensureRgssSourcesIndex(contentRoot: string, dataDir: string, build: () => string[]): Set<string> {
  const signature = rgssDataSignature(dataDir)
  const hit = readIndex(contentRoot)
  if (hit && hit.signature === signature) return new Set(hit.sources)
  const sources = build()
  writeRgssSourcesIndex(contentRoot, signature, sources)
  return new Set(sources)
}
