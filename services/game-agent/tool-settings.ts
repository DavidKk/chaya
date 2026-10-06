import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import { DEFAULT_TOOL_SETTINGS, normalizeToolSettings, type ToolSettings } from '@/lib/game-agent/tool-settings'

export const TOOL_SETTINGS_PATH = path.join(DATA_DIR, 'game-agent', 'tool-settings.json')

export function loadToolSettings(file = TOOL_SETTINGS_PATH): ToolSettings {
  try {
    return normalizeToolSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return DEFAULT_TOOL_SETTINGS
  }
}

export function saveToolSettings(settings: ToolSettings, file = TOOL_SETTINGS_PATH): ToolSettings {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
  return settings
}
