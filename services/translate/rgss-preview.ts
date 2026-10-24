import fs from 'node:fs'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { DEFAULT_RGSS_PREVIEW, normalizeRgssPreview, type RgssPreviewSettings, type RgssPreviewView } from '@/lib/translate/rgss-preview'
import { rgssDataDir } from '@/services/extract/lib/rgss'

/**
 * Seed 页「游戏内：原文/译文」：只写 `chaya/config/translation-preview.json`。
 * 局内 Ruby 读该文件，渲染时开/关查表替换；不还原、不写回 Data。
 */
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

export function setRgssPreviewView(contentRoot: string, view: RgssPreviewView): { view: RgssPreviewView } {
  if (!rgssDataDir(contentRoot)) throw new Error('RGSS Data/ directory not found')
  writePreviewSettings(contentRoot, { view })
  return { view }
}

export function describeRgssPreview(contentRoot: string): {
  view: RgssPreviewView
  isRgss: boolean
} {
  return {
    view: getRgssPreviewSettings(contentRoot).view,
    isRgss: Boolean(rgssDataDir(contentRoot)),
  }
}
