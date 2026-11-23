import fs from 'node:fs'
import path from 'node:path'

export type GameLocalesCatalog = {
  hasLocales: boolean
  localesDir?: string
  localesFiles?: string[]
  /** Available language codes, e.g. ["en", "ru", "zh", "ja", "ko"] */
  languages: string[]
  /** Primary / original language, e.g. "ru" or "en" or "ja" */
  primaryLanguage: string
  /** Map of lang -> (key -> text) */
  dictionaries: Record<string, Record<string, string>>
  /** Map of key -> relative file path in locales, e.g. "Act1.json" or "csv/UI.csv" */
  keyToFileMap: Record<string, string>
}

export type ParallelCorpusPair = {
  src: string
  zh: string
  from: string
  to: string
  engine: 'game:locales'
}

export { formatLanguageLabel, LANGUAGE_LABELS } from '@/lib/translate/locales-labels'

/** Check if a candidate directory has genuine script JSON/CSV files rather than Chromium system .pak files */
function isValidLocalesDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  // Guard: if all entries are .pak / .pak.info or no directories, ignore Chromium locales
  const subDirs = entries.filter((e) => e.isDirectory())
  if (!subDirs.length) {
    // Check if directly contains .json / .csv
    const jsonFiles = entries.filter((e) => e.isFile() && /\.(json|csv)$/i.test(e.name))
    return jsonFiles.length > 0
  }
  // Check if any subfolder contains json files
  for (const sub of subDirs) {
    const subPath = path.join(dirPath, sub.name)
    try {
      const files = fs.readdirSync(subPath)
      if (files.some((f) => /\.(json|csv)$/i.test(f))) {
        return true
      }
    } catch {
      // ignore
    }
  }
  return false
}

/** Locate the authentic localization folder */
export function findLocalesDirectory(contentRoot: string): string | null {
  const candidates = [
    path.join(contentRoot, 'locales'),
    path.join(contentRoot, 'www', 'locales'),
    path.join(contentRoot, 'localization'),
    path.join(contentRoot, 'www', 'localization'),
    path.join(contentRoot, 'languages'),
    path.join(contentRoot, 'www', 'languages'),
    path.join(contentRoot, 'data', 'locales'),
    path.join(contentRoot, 'data', 'localization'),
    path.join(contentRoot, 'csv'),
    path.join(contentRoot, 'www', 'csv'),
  ]

  // Also probe plugins.js if available
  const pluginsPaths = [path.join(contentRoot, 'js', 'plugins.js'), path.join(contentRoot, 'www', 'js', 'plugins.js')]
  for (const pp of pluginsPaths) {
    if (fs.existsSync(pp)) {
      try {
        const text = fs.readFileSync(pp, 'utf8')
        const locMatch = text.match(/"Localization Folder"\s*:\s*"([^"]+)"/)
        if (locMatch && locMatch[1]) {
          const folder = locMatch[1].replace(/^[\\/]+|[\\/]+$/g, '')
          candidates.unshift(path.join(path.dirname(path.dirname(pp)), folder))
          candidates.unshift(path.join(contentRoot, folder))
        }
      } catch {
        // ignore
      }
    }
  }

  for (const cand of candidates) {
    if (isValidLocalesDir(cand)) {
      return cand
    }
  }

  return null
}

/** Clean braces and \\T[...] tokens from a key, e.g. "{Map007-42}" -> "Map007-42", "\\T[MES0002]" -> "MES0002" */
export function normalizeLocalesKey(rawKey: string): string {
  if (typeof rawKey !== 'string') return ''
  const k = rawKey.trim().replace(/^\{+/, '').replace(/\}+$/, '').trim()
  const tMatch = k.match(/^\\(?:T|t)\[([^\]]+)\]$/)
  if (tMatch) return tMatch[1].trim()
  return k
}

/** Parse RFC 4180 quoted fields, escaped quotes and embedded line breaks. */
export function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i]
    if (char === '"') {
      if (quoted && clean[i + 1] === '"') {
        field += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (!quoted && /[,\r\n]/.test(char)) {
      fields.push(field)
      field = ''
      if (char !== ',') {
        rows.push(fields)
        fields = []
        if (char === '\r' && clean[i + 1] === '\n') i++
      }
    } else {
      field += char
    }
  }
  fields.push(field)
  rows.push(fields)
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
}

export function canonicalLanguageCode(code: string, label?: string): string {
  const normLabel = (label || '').toLowerCase().trim()
  if (normLabel) {
    if (/日[本語文]|japan/i.test(normLabel)) return 'ja'
    if (/中[文国]|繁[体體]|简[体體]|chinese/i.test(normLabel)) return 'zh'
    if (/英[语文]|english/i.test(normLabel)) return 'en'
    if (/俄[语文]|russian/i.test(normLabel)) return 'ru'
    if (/韩[语文]|韓[語文]|korean/i.test(normLabel)) return 'ko'
  }
  const normCode = (code || '').toLowerCase().trim()
  if (normCode === 'tw' || normCode === 'cn' || normCode === 'ch' || normCode === 'zh_cn' || normCode === 'zh-cn') return 'zh'
  if (normCode === 'jp' || normCode === 'ja') return 'ja'
  if (normCode === 'en') return 'en'
  if (normCode === 'ru') return 'ru'
  if (normCode === 'ko' || normCode === 'kr') return 'ko'
  return normCode
}

/** Resolve text containing \\T[...] or locales keys using dictionary */
export function resolveLocalesText(text: string, dict?: Record<string, string>): string {
  if (!text || !dict) return text
  const norm = normalizeLocalesKey(text)
  if (dict[norm] != null) return dict[norm]
  if (dict[text] != null) return dict[text]
  return text.replace(/\\(?:T|t)\[([^\]]+)\]/g, (match, key) => {
    const cleanKey = key.trim()
    return dict[cleanKey] ?? dict[normalizeLocalesKey(cleanKey)] ?? match
  })
}

function parseArrayParam(param: unknown): string[] {
  if (Array.isArray(param)) return param.map(String)
  if (typeof param !== 'string') return []
  const trimmed = param.trim()
  try {
    const jsonStr = trimmed.replace(/'/g, '"')
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch {
    const matches = trimmed.match(/['"]([^'"]+)['"]/g)
    if (matches) return matches.map((m) => m.replace(/['"]/g, ''))
  }
  return []
}

/** Load all language dictionaries from directory or CSV files */
export function loadGameLocalesCatalog(contentRoot: string): GameLocalesCatalog {
  const localesDir = findLocalesDirectory(contentRoot)
  const dictionaries: Record<string, Record<string, string>> = {}
  const keyToFileMap: Record<string, string> = {}
  const localesFiles: string[] = []

  // 1. Probe directory-based JSON locales (e.g. locales/en/*.json, locales/ru/*.json)
  if (localesDir && fs.existsSync(localesDir)) {
    try {
      const entries = fs.readdirSync(localesDir, { withFileTypes: true })
      const langDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

      for (const lang of langDirs) {
        const langPath = path.join(localesDir, lang)
        dictionaries[lang] = dictionaries[lang] || {}
        try {
          const files = fs.readdirSync(langPath).filter((f) => /\.json$/i.test(f))
          for (const file of files) {
            const filePath = path.join(langPath, file)
            const relPath = path.relative(contentRoot, filePath)
            if (!localesFiles.includes(relPath)) localesFiles.push(relPath)
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
              if (data && typeof data === 'object') {
                for (const [k, v] of Object.entries(data)) {
                  if (typeof v === 'string') {
                    const normK = normalizeLocalesKey(k)
                    dictionaries[lang][normK] = v
                    dictionaries[lang][k] = v // also store original key
                    if (!keyToFileMap[normK]) {
                      keyToFileMap[normK] = file
                    }
                  }
                }
              }
            } catch {
              // ignore corrupted json
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Probe CSV-based multilingual localization (e.g. Chimaki_Lang, csv/UI.csv)
  const pluginsPaths = [path.join(contentRoot, 'js', 'plugins.js'), path.join(contentRoot, 'www', 'js', 'plugins.js')]
  let chimakiConfig: { defaultLang?: string; allLang?: string[]; allLangShow?: string[]; loadfileName?: string[] } | null = null

  for (const pp of pluginsPaths) {
    if (fs.existsSync(pp)) {
      try {
        const code = fs.readFileSync(pp, 'utf8')
        const pluginMatch = code.match(/\{[^{}]*"name"\s*:\s*"Chimaki_Lang"[\s\S]*?"parameters"\s*:\s*\{([^}]+)\}/)
        if (pluginMatch) {
          const paramsStr = `{${pluginMatch[1]}}`
          const params = JSON.parse(paramsStr)
          chimakiConfig = {
            defaultLang: params.defaultLang,
            allLang: parseArrayParam(params.allLang),
            allLangShow: parseArrayParam(params.allLangShow),
            loadfileName: parseArrayParam(params.loadfileName),
          }
          break
        }
      } catch {
        // ignore parse error
      }
    }
  }

  const csvDirCandidates = [path.join(contentRoot, 'csv'), path.join(contentRoot, 'www', 'csv'), ...(localesDir ? [localesDir] : [])]

  let resolvedCsvDir: string | null = null
  for (const dir of csvDirCandidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      resolvedCsvDir = dir
      break
    }
  }

  if (resolvedCsvDir) {
    const csvFileNames = chimakiConfig?.loadfileName?.length
      ? chimakiConfig.loadfileName.map((f) => (/\.csv$/i.test(f) ? f : `${f}.csv`))
      : fs.readdirSync(resolvedCsvDir).filter((f) => /\.csv$/i.test(f))

    for (const csvFileName of csvFileNames) {
      const csvFullPath = path.join(resolvedCsvDir, csvFileName)
      if (!fs.existsSync(csvFullPath)) continue
      const relCsvPath = path.relative(contentRoot, csvFullPath)
      if (!localesFiles.includes(relCsvPath)) localesFiles.push(relCsvPath)

      try {
        const content = fs.readFileSync(csvFullPath, 'utf8')
        const rows = parseCsvRows(content)
        if (rows.length < 2) continue

        const header = rows[0].map((h) => h.trim())
        const idCol = header.findIndex((h) => /^id$/i.test(h))
        const actualIdCol = idCol >= 0 ? idCol : 0

        // Map columns to languages
        const colToLang: Record<number, string> = {}
        for (let c = 0; c < header.length; c++) {
          if (c === actualIdCol) continue
          const colName = header[c]
          if (/^who$/i.test(colName) || /^note$/i.test(colName) || /^remark$/i.test(colName)) continue

          let canon = ''
          if (chimakiConfig?.allLang?.length && chimakiConfig.allLang.includes(colName)) {
            const idx = chimakiConfig.allLang.indexOf(colName)
            const show = chimakiConfig.allLangShow?.[idx]
            canon = canonicalLanguageCode(colName, show)
          } else {
            canon = canonicalLanguageCode(colName)
          }
          if (canon) {
            colToLang[c] = canon
            dictionaries[canon] = dictionaries[canon] || {}
          }
        }

        for (let r = 1; r < rows.length; r++) {
          const row = rows[r]
          const id = row[actualIdCol]?.trim()
          if (!id) continue

          for (const [colStr, lang] of Object.entries(colToLang)) {
            const c = Number(colStr)
            const val = row[c] ?? ''
            dictionaries[lang][id] = val
            dictionaries[lang][`\\T[${id}]`] = val
            dictionaries[lang][`\\t[${id}]`] = val
          }
          keyToFileMap[id] = relCsvPath
          keyToFileMap[`\\T[${id}]`] = relCsvPath
          keyToFileMap[`\\t[${id}]`] = relCsvPath
        }
      } catch {
        // ignore csv error
      }
    }
  }

  const languages = Object.keys(dictionaries).filter((l) => Object.keys(dictionaries[l]).length > 0)

  // Determine primary language
  let primaryLanguage = languages[0] || ''
  if (chimakiConfig?.defaultLang) {
    const idx = chimakiConfig.allLang?.indexOf(chimakiConfig.defaultLang) ?? -1
    const show = idx >= 0 ? chimakiConfig.allLangShow?.[idx] : undefined
    const canonDefault = canonicalLanguageCode(chimakiConfig.defaultLang, show)
    if (languages.includes(canonDefault)) {
      primaryLanguage = canonDefault
    }
  }
  if (!primaryLanguage) {
    if (languages.includes('ja')) primaryLanguage = 'ja'
    else if (languages.includes('ru')) primaryLanguage = 'ru'
    else if (languages.includes('en')) primaryLanguage = 'en'
  }

  return {
    hasLocales: languages.length > 0,
    localesDir: localesDir || resolvedCsvDir || undefined,
    localesFiles,
    languages,
    primaryLanguage,
    dictionaries,
    keyToFileMap,
  }
}

/** Generate non-redundant parallel text pairs across languages for translate database pre-warming */
export function extractParallelCorpus(catalog: GameLocalesCatalog): ParallelCorpusPair[] {
  if (!catalog.hasLocales || catalog.languages.length < 2) return []

  const pairs: ParallelCorpusPair[] = []
  const seen = new Set<string>()

  const allKeys = Object.keys(catalog.keyToFileMap).filter((k) => !/^\\(?:T|t)\[/.test(k))

  for (const key of allKeys) {
    for (const langA of catalog.languages) {
      const textA = catalog.dictionaries[langA]?.[key]
      if (!textA || !textA.trim()) continue
      const cleanA = textA.trim()

      for (const langB of catalog.languages) {
        if (langA === langB) continue
        const textB = catalog.dictionaries[langB]?.[key]
        if (!textB || !textB.trim()) continue
        const cleanB = textB.trim()

        // Skip exact identical text (like ..., numbers, pure symbols)
        if (cleanA === cleanB) continue
        // Skip purely numeric or single symbol texts
        if (/^[\d\s\.,!?;:\-_+=\\/\[\]{}()<>|]+$/.test(cleanA)) continue

        const pairKey = `${langA}->${langB}:${cleanA}===${cleanB}`
        if (seen.has(pairKey)) continue
        seen.add(pairKey)

        pairs.push({
          src: cleanA,
          zh: cleanB,
          from: langA,
          to: langB,
          engine: 'game:locales',
        })
      }
    }
  }

  return pairs
}
