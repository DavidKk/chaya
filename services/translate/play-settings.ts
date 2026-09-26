import fs from 'node:fs'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { normalizePlaySettings, type TranslationPlaySettings } from '@/lib/translate/play-settings'

export function getTranslationPlaySettings(contentRoot: string): TranslationPlaySettings {
  const file = gameContentReadPath(contentRoot, 'translationPlay')
  if (!file) return normalizePlaySettings(null)
  return normalizePlaySettings(JSON.parse(fs.readFileSync(file, 'utf8')))
}

export function setTranslationPlaySettings(contentRoot: string, input: unknown): TranslationPlaySettings {
  const settings = normalizePlaySettings(input)
  const file = ensureGameContentDir(contentRoot, 'translationPlay')
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
  return settings
}
