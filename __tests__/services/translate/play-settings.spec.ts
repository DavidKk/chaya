import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { DEFAULT_PLAY_SETTINGS } from '@/lib/translate/play-settings'
import { getTranslationPlaySettings, setTranslationPlaySettings } from '@/services/translate/play-settings'

it('defaults to offline cache playback and persists independent per-game settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-play-settings-'))
  const second = path.join(root, 'other-game')
  try {
    expect(getTranslationPlaySettings(root)).toEqual(DEFAULT_PLAY_SETTINGS)
    setTranslationPlaySettings(root, { mode: 'realtime', model: ' mini:local ', timeoutMs: 99_000 })
    expect(getTranslationPlaySettings(root)).toEqual({ mode: 'realtime', model: 'mini:local', timeoutMs: 30_000 })
    setTranslationPlaySettings(root, { mode: 'subtitle', timeoutMs: 8_000 })
    expect(getTranslationPlaySettings(root).mode).toBe('subtitle')
    expect(getTranslationPlaySettings(second)).toEqual(DEFAULT_PLAY_SETTINGS)
    expect(fs.existsSync(gameContentPath(root, 'switches'))).toBe(false)
    expect(fs.readdirSync(path.dirname(gameContentPath(root, 'translationPlay')))).toEqual(['translation-play.json'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
