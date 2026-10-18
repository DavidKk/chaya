import fs from 'node:fs'
import path from 'node:path'

export type GameLocalesCatalog = {
  hasLocales: boolean
  localesDir?: string
  /** Available language codes, e.g. ["en", "ru", "ch", "ja", "ko"] */
  languages: string[]
  /** Primary / original language, e.g. "ru" or "en" */
  primaryLanguage: string
  /** Map of lang -> (key -> text) */
  dictionaries: Record<string, Record<string, string>>
  /** Map of key -> relative file path in locales, e.g. "Act1.json" */
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

/** Clean braces from a key, e.g. "{Map007-42}" -> "Map007-42" */
export function normalizeLocalesKey(rawKey: string): string {
  if (typeof rawKey !== 'string') return ''
  return rawKey.trim().replace(/^\{+/, '').replace(/\}+$/, '').trim()
}

/** Load all language dictionaries from directory */
export function loadGameLocalesCatalog(contentRoot: string): GameLocalesCatalog {
  const localesDir = findLocalesDirectory(contentRoot)
  if (!localesDir) {
    return {
      hasLocales: false,
      languages: [],
      primaryLanguage: '',
      dictionaries: {},
      keyToFileMap: {},
    }
  }

  const entries = fs.readdirSync(localesDir, { withFileTypes: true })
  const langDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)

  const dictionaries: Record<string, Record<string, string>> = {}
  const keyToFileMap: Record<string, string> = {}

  for (const lang of langDirs) {
    const langPath = path.join(localesDir, lang)
    dictionaries[lang] = {}
    try {
      const files = fs.readdirSync(langPath).filter((f) => /\.json$/i.test(f))
      for (const file of files) {
        const filePath = path.join(langPath, file)
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

  const languages = Object.keys(dictionaries).filter((l) => Object.keys(dictionaries[l]).length > 0)

  // Primary language detection: prefer ru or en, or first language
  let primaryLanguage = languages[0] || ''
  if (languages.includes('ru')) primaryLanguage = 'ru'
  else if (languages.includes('en')) primaryLanguage = 'en'

  return {
    hasLocales: languages.length > 0,
    localesDir,
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

  const allKeys = Object.keys(catalog.keyToFileMap)

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
