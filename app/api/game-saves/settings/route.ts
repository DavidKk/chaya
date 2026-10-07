import fs from 'node:fs'
import path from 'node:path'

import { defineApiRoute } from '@/initializer/controller'
import { apiBadRequest, apiOk } from '@/initializer/response'
import { DEFAULT_GAME_SAVES_SETTINGS, type GameSavesSettings, parseGameSavesSettings, validateGameSavesSettings } from '@/lib/game/game-saves'
import { toolkitDataDir } from '@/lib/game/toolkit-data'
import { MESSAGES, translate } from '@/lib/i18n'
import { requireDisk } from '@/lib/service-mode'

export const runtime = 'nodejs'

function settingsFile(): string {
  return path.join(toolkitDataDir(), 'game-saves', 'settings.json')
}

function readSettings(): GameSavesSettings {
  let text: string
  try {
    text = fs.readFileSync(settingsFile(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_GAME_SAVES_SETTINGS
    throw error
  }
  return parseGameSavesSettings(JSON.parse(text))
}

export const GET = defineApiRoute('get:/api/game-saves/settings', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ settings: readSettings() })
})

/** revision 只增不减；采用游戏侧更新的设置时可以一次跳过多个版本 */
export const PUT = defineApiRoute('put:/api/game-saves/settings', async ({ request }) => {
  const denied = requireDisk()
  if (denied) return denied
  const body = await request.json().catch(() => null)
  const raw = body?.settings
  const issue = validateGameSavesSettings(raw)
  if (issue) return apiBadRequest(translate(MESSAGES.en, issue.key, issue.params), 'INVALID_SETTINGS')
  const next = parseGameSavesSettings(raw)
  const current = readSettings()
  if (body.expectedRevision !== current.revision || next.revision <= current.revision)
    return apiBadRequest(translate(MESSAGES.en, 'saves.error.revisionConflict'), 'REVISION_CONFLICT')
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2))
  fs.renameSync(temporary, file)
  return apiOk({ settings: next })
})
