import fs from 'node:fs'
import path from 'node:path'

import { CONFIG_FILE_PATH, LEGACY_CONFIG_FILE_PATHS } from '@/constants/paths'
import type { ChayaConfig } from '@/lib/game'

import { isLibraryEntryId, normalizeLibrary, pathEquals } from './library'

function ensureConfigDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function readConfigFile(file: string): ChayaConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ChayaConfig> & {
      library?: unknown
    }
    const gameRoot = String(raw.gameRoot || '')
    return {
      gameRoot,
      shellSource: String(raw.shellSource || ''),
      library: normalizeLibrary(raw.library, gameRoot),
    }
  } catch {
    return null
  }
}

/** Persist path-base64url → UUID ids so cold starts do not re-issue them */
function persistLibraryIdMigration(file: string, config: ChayaConfig): void {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { library?: unknown }
    const disk = Array.isArray(raw.library) ? raw.library : []
    const needsWrite = config.library.some((entry) => {
      const prev = disk.find((item) => item && typeof item === 'object' && pathEquals(String((item as { gameRoot?: string }).gameRoot || ''), entry.gameRoot)) as
        { id?: string } | undefined
      const oldId = String(prev?.id || '').trim()
      return !isLibraryEntryId(oldId) || oldId !== entry.id
    })
    if (!needsWrite) return
    ensureConfigDir(file)
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
  } catch {
    /* ignore migrate write */
  }
}

function writeConfigFile(file: string, config: ChayaConfig): void {
  ensureConfigDir(file)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

export function loadConfig(): ChayaConfig {
  const current = readConfigFile(CONFIG_FILE_PATH)
  if (current) {
    persistLibraryIdMigration(CONFIG_FILE_PATH, current)
    return current
  }

  for (const legacyPath of LEGACY_CONFIG_FILE_PATHS) {
    const legacy = readConfigFile(legacyPath)
    if (!legacy) continue
    try {
      writeConfigFile(CONFIG_FILE_PATH, legacy)
    } catch {
      /* ignore migrate write */
    }
    return legacy
  }

  return { gameRoot: '', shellSource: '', library: [] }
}

export function saveConfig(partial: Partial<ChayaConfig>): ChayaConfig {
  const prev = loadConfig()
  const next: ChayaConfig = {
    gameRoot: partial.gameRoot !== undefined ? String(partial.gameRoot || '') : prev.gameRoot,
    shellSource: partial.shellSource !== undefined ? String(partial.shellSource || '') : prev.shellSource,
    library: partial.library !== undefined ? normalizeLibrary(partial.library) : prev.library,
  }
  writeConfigFile(CONFIG_FILE_PATH, next)
  return next
}

/** @deprecated use `CONFIG_FILE_PATH` from `@/constants` */
export const CONFIG_FILE = CONFIG_FILE_PATH
