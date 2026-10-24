import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { TRANSLATION_PACKS_DIR } from '@/constants/paths'
import { bergamotLanguage, type BergamotPack, type PackReference } from '@/lib/translate/bergamot'

import { findPack } from './catalog'

/** Legacy XDG layout (pre–DATA_DIR default); still readable until migrated. */
function legacyPacksRoot(): string {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'chaya/translation-packs')
}

function adoptLegacyPacks(preferred: string, legacy: string) {
  try {
    if (fs.existsSync(preferred) || !fs.existsSync(legacy)) return
    fs.mkdirSync(path.dirname(preferred), { recursive: true })
    fs.renameSync(legacy, preferred)
  } catch {
    /* cross-device rename may fail — packsRoot falls back to legacy */
  }
}

/** Packs live under toolkit `data/translation-packs` so backups cover them; override with `CHAYA_BERGAMOT_PACKS_DIR`. */
export function packsRoot(): string {
  if (process.env.CHAYA_BERGAMOT_PACKS_DIR) return path.resolve(process.env.CHAYA_BERGAMOT_PACKS_DIR)
  const preferred = path.resolve(TRANSLATION_PACKS_DIR)
  const legacy = path.resolve(legacyPacksRoot())
  adoptLegacyPacks(preferred, legacy)
  if (!fs.existsSync(preferred) && fs.existsSync(legacy)) return legacy
  return preferred
}
export function safeId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(value)) throw new Error('PACK_INVALID_REFERENCE')
  return value
}
export function installationRoot(ref: PackReference): string {
  return path.join(packsRoot(), 'packs', safeId(ref.packId), safeId(ref.version), safeId(ref.installId))
}
export function pairFolder(source: string, target: string): string {
  return `${safeId(bergamotLanguage(source))}_${safeId(bergamotLanguage(target))}`
}
export function syncDirectory(directory: string) {
  const fd = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
export function atomicJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  const fd = fs.openSync(temp, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(value))
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(temp, file)
  syncDirectory(path.dirname(file))
}
export type InstalledManifest = {
  reference: PackReference
  source: string
  target: string
  binaryHash: string
  files: Array<{ name: string; bytes: number; mtimeMs: number; sha256: string }>
}
export function installedPack(source: string, target: string): { root: string; manifest: InstalledManifest } | undefined {
  try {
    const packId = `${bergamotLanguage(source)}-${bergamotLanguage(target)}`
    const ref = JSON.parse(fs.readFileSync(path.join(packsRoot(), 'active', `${safeId(packId)}.json`), 'utf8')) as PackReference
    if (ref.packId !== packId) return
    const root = installationRoot(ref)
    if (!fs.realpathSync(root).startsWith(fs.realpathSync(packsRoot()) + path.sep)) return
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as InstalledManifest
    if (JSON.stringify(manifest.reference) !== JSON.stringify(ref) || manifest.source !== bergamotLanguage(source) || manifest.target !== bergamotLanguage(target)) return
    const pack = findPack(source, target)
    if (!pack || ref.version !== pack.version || manifest.files.length !== pack.files.length + 1) return
    const expected = new Map([
      ...pack.files.map((file) => [file.name, file.unpackedSha256] as const),
      ['config.yml', createHash('sha256').update(pack.config).digest('hex')] as const,
    ])
    const folder = path.join(root, pairFolder(source, target))
    if (fs.lstatSync(folder).isSymbolicLink() || fs.realpathSync(folder) !== path.join(fs.realpathSync(root), pairFolder(source, target))) return
    for (const item of manifest.files) {
      if (expected.get(item.name) !== item.sha256) return
      expected.delete(item.name)
      const file = path.join(root, pairFolder(source, target), item.name)
      safeId(item.name.replaceAll('.', '_'))
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || stat.mtimeMs !== item.mtimeMs) return
    }
    if (expected.size) return
    return { root, manifest }
  } catch {
    return
  }
}
export function managedRoot(source: string, target: string) {
  return installedPack(source, target)?.root
}
export function contentId(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
export function packBytes(pack: BergamotPack) {
  return pack.files.reduce((sum, file) => sum + file.bytes, 0)
}
