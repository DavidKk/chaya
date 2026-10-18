import fs from 'node:fs'
import path from 'node:path'

import { updateSharedTranslateCache } from '@/services/translate/cache-api'
import { appendGameNdjson } from '@/services/translate/live-translate'

import { findLocalesDirectory, loadGameLocalesCatalog, normalizeLocalesKey } from './game-locales'

export type SaveLocalesItemParams = {
  contentRoot: string
  localesKey: string
  text: string
  zh: string
  sourceLang?: string
  targetLang?: string
  targetFile?: string
}

export type SaveLocalesItemResult = {
  ok: boolean
  file?: string
  backupCreated?: boolean
  error?: string
}

/**
 * Save translated text back to the game locales JSON file.
 * Automatically backs up the target file as *.bak.json on first write.
 * Also persists the translation (text <-> zh) to translate-cache.db and cache.ndjson.
 */
export function saveLocalesItem(params: SaveLocalesItemParams): SaveLocalesItemResult {
  const { contentRoot, localesKey, text, zh, sourceLang = 'en', targetLang = 'ch', targetFile } = params

  const cleanKey = normalizeLocalesKey(localesKey)
  if (!cleanKey) {
    return { ok: false, error: '缺少有效的本地化 Key' }
  }

  const localesDir = findLocalesDirectory(contentRoot)
  if (!localesDir) {
    return { ok: false, error: '未找到多语言目录' }
  }

  const catalog = loadGameLocalesCatalog(contentRoot)

  // 1. Determine target file name
  let fileName = targetFile
  if (!fileName) {
    fileName = catalog.keyToFileMap[cleanKey] || catalog.keyToFileMap[localesKey]
  }
  if (!fileName) {
    // If unknown, fallback to first json in targetLang folder or Manual.json
    const targetFolder = path.join(localesDir, targetLang)
    if (fs.existsSync(targetFolder)) {
      try {
        const jsons = fs.readdirSync(targetFolder).filter((f) => /\.json$/i.test(f) && !/\.bak\.json$/i.test(f))
        if (jsons.length > 0) fileName = jsons[0]
      } catch {
        // ignore
      }
    }
    if (!fileName) fileName = 'Translations.json'
  }

  const langDir = path.join(localesDir, targetLang)
  if (!fs.existsSync(langDir)) {
    try {
      fs.mkdirSync(langDir, { recursive: true })
    } catch (e) {
      return { ok: false, error: '创建目标语言目录失败: ' + String(e) }
    }
  }

  const targetPath = path.join(langDir, fileName)
  const backupPath = targetPath.replace(/\.json$/i, '.bak.json')

  let backupCreated = false

  // 2. Backup on first modification if target file exists and backup does not
  if (fs.existsSync(targetPath) && !fs.existsSync(backupPath)) {
    try {
      fs.copyFileSync(targetPath, backupPath)
      backupCreated = true
    } catch (e) {
      console.warn('[save-locales-item] Failed to backup original locales file:', e)
    }
  }

  // 3. Read and update the JSON dictionary
  let dict: Record<string, string> = {}
  if (fs.existsSync(targetPath)) {
    try {
      dict = JSON.parse(fs.readFileSync(targetPath, 'utf8')) || {}
    } catch {
      dict = {}
    }
  }

  // Update key value (support both clean key and original bracketed key if existed)
  if (localesKey in dict) {
    dict[localesKey] = zh
  } else {
    dict[cleanKey] = zh
  }

  // 4. Atomic write
  try {
    const tempPath = `${targetPath}.${Date.now()}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(dict, null, 2) + '\n', 'utf8')
    fs.renameSync(tempPath, targetPath)
  } catch (e) {
    return { ok: false, error: '写入目标语言文件失败: ' + String(e) }
  }

  // 5. Update SQLite translate-cache.db with pure Text <-> Text
  if (text && zh && text.trim() !== zh.trim()) {
    try {
      updateSharedTranslateCache(text.trim(), zh.trim(), 'manual', {
        from: sourceLang,
        to: targetLang,
      })
    } catch (e) {
      console.warn('[save-locales-item] Failed to update translation cache:', e)
    }
  }

  // 6. Append to per-game cache.ndjson
  if (text && zh) {
    appendGameNdjson(contentRoot, [[text, zh]])
  }

  return {
    ok: true,
    file: fileName,
    backupCreated,
  }
}
