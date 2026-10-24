import fs from 'node:fs'

import { CONFIG_FILE_PATH, LEGACY_CONFIG_FILE_PATHS } from '@/constants/paths'

export function storageLibraryEntries(): Array<{ id: string; gameRoot: string; remote?: boolean }> {
  for (const file of [CONFIG_FILE_PATH, ...LEGACY_CONFIG_FILE_PATHS]) {
    if (!fs.existsSync(file)) continue
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { library?: Array<{ id: string; gameRoot: string; remote?: boolean }> }
    return value.library || []
  }
  return []
}
