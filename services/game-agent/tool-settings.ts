import fs from 'node:fs'
import path from 'node:path'

import { DATA_DIR } from '@/constants/paths'
import { DEFAULT_TOOL_SETTINGS, normalizeToolSettings, type ToolSettings } from '@/lib/game-agent/tool-settings'
import { storageCall } from '@/services/storage/client'

export const TOOL_SETTINGS_PATH = path.join(DATA_DIR, 'game-agent', 'tool-settings.json')

export function loadToolSettings(file = TOOL_SETTINGS_PATH): ToolSettings {
  if (file === TOOL_SETTINGS_PATH && process.env.CHAYA_STORAGE_OWNER !== '1') return normalizeToolSettings(storageCall('config.get', ['toolSettings']))
  try {
    return normalizeToolSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return DEFAULT_TOOL_SETTINGS
  }
}

export function saveToolSettings(settings: ToolSettings, file = TOOL_SETTINGS_PATH): ToolSettings {
  if (file === TOOL_SETTINGS_PATH && process.env.CHAYA_STORAGE_OWNER !== '1') return storageCall('config.set', ['toolSettings', settings])
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  fs.renameSync(temp, file)
  return settings
}
