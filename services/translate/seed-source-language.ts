import fs from 'node:fs'

import { gameContentReadPath, localGameContentFile } from '@/lib/game/content-files'
import { detectSourceLanguage } from '@/lib/translate/source-text'
import { filterRgssSeedKeys } from '@/services/extract/lib/rgss'
import { getResolvedFromConfig } from '@/services/game/binding'

export function loadSeedKeys(contentRoot: string): string[] {
  const file = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (!file || !fs.existsSync(file)) return []
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    return filterRgssSeedKeys(
      contentRoot,
      Object.keys(raw).filter((key) => key.trim())
    )
  } catch {
    return []
  }
}

export function getSeedSourceLanguage(contentRoot?: string): string {
  const resolved = getResolvedFromConfig()
  const root = contentRoot || (resolved.ok ? resolved.contentRoot : '')
  if (!root) return ''
  const seedKeys = loadSeedKeys(root)
  if (seedKeys.length) return detectSourceLanguage(seedKeys)
  try {
    const extractFile = localGameContentFile(root, 'extractStrings')
    if (extractFile && fs.existsSync(extractFile)) {
      const parsed = JSON.parse(fs.readFileSync(extractFile, 'utf8'))
      if (parsed?.meta?.sourceLanguage && typeof parsed.meta.sourceLanguage === 'string') {
        return parsed.meta.sourceLanguage
      }
    }
  } catch {
    /* ignore parse errors */
  }
  return ''
}
