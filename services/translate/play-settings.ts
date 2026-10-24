import fs from 'node:fs'

import { gameContentReadPath } from '@/lib/game/content-files'
import { normalizePlaySettings, type TranslationPlaySettings } from '@/lib/translate/play-settings'
import { writePublicGameDocument } from '@/services/storage/game-files'

export function getTranslationPlaySettings(contentRoot: string): TranslationPlaySettings {
  const file = gameContentReadPath(contentRoot, 'translationPlay')
  if (!file) return normalizePlaySettings(null)
  return normalizePlaySettings(JSON.parse(fs.readFileSync(file, 'utf8')))
}

export function setTranslationPlaySettings(contentRoot: string, input: unknown): TranslationPlaySettings {
  const settings = normalizePlaySettings(input)
  writePublicGameDocument(contentRoot, 'translationPlay', settings)
  return settings
}
