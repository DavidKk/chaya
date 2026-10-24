import fs from 'node:fs'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { DEFAULT_RGSS_PREVIEW, normalizeRgssPreview, type RgssPreviewSettings, type RgssPreviewView } from '@/lib/translate/rgss-preview'
import { loadRgssTranslationItems, rgssDataDir, writeRgssTranslations } from '@/services/extract/lib/rgss'
import { restoreRgssFromBackup } from '@/services/extract/lib/rgss/writeback'

export function getRgssPreviewSettings(contentRoot: string): RgssPreviewSettings {
  const file = gameContentReadPath(contentRoot, 'translationPreview')
  if (!file) return { ...DEFAULT_RGSS_PREVIEW }
  try {
    return normalizeRgssPreview(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return { ...DEFAULT_RGSS_PREVIEW }
  }
}

function writePreviewSettings(contentRoot: string, settings: RgssPreviewSettings): RgssPreviewSettings {
  const normalized = normalizeRgssPreview(settings)
  const file = ensureGameContentDir(contentRoot, 'translationPreview')
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(normalized)}\n`, 'utf8')
  fs.renameSync(tmp, file)
  return normalized
}

export function setRgssPreviewView(
  contentRoot: string,
  view: RgssPreviewView
): {
  view: RgssPreviewView
  restored: number
  written: number
  backups: number
} {
  const dataDir = rgssDataDir(contentRoot)
  if (!dataDir) throw new Error('RGSS Data/ directory not found')

  if (view === 'original') {
    const { restored, backups } = restoreRgssFromBackup(dataDir)
    writePreviewSettings(contentRoot, { view: 'original' })
    return { view: 'original', restored, written: 0, backups }
  }

  const translations: Record<string, string> = {}
  for (const item of loadRgssTranslationItems(contentRoot)) {
    if (item.meta.isHardcoded) continue
    const zh = (item.zh || item.savedZh || '').trim()
    if (!zh || zh === item.src) continue
    translations[item.src] = zh
  }
  let written = 0
  let backups = countBackups(dataDir)
  if (Object.keys(translations).length) {
    const result = writeRgssTranslations(contentRoot, translations)
    written = result.replacements
    backups = countBackups(dataDir)
  }
  writePreviewSettings(contentRoot, { view: 'translated' })
  return { view: 'translated', restored: 0, written, backups }
}

function countBackups(dataDir: string): number {
  try {
    return fs.readdirSync(dataDir).filter((name) => /\.rvdata2?\.chaya\.bak$/i.test(name)).length
  } catch {
    return 0
  }
}

export function describeRgssPreview(contentRoot: string): {
  view: RgssPreviewView
  backups: number
  isRgss: boolean
} {
  const dataDir = rgssDataDir(contentRoot)
  return {
    view: getRgssPreviewSettings(contentRoot).view,
    backups: dataDir ? countBackups(dataDir) : 0,
    isRgss: Boolean(dataDir),
  }
}
