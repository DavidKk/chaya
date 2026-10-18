import { DB_SPECS } from '@/lib/translate/database-fields'

import { isTechnicalField, isTextField } from './data-fields'
import { extractPluginText } from './plugin-text'

type NodeFiles = { fs: typeof import('node:fs'); path: typeof import('node:path') }
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'chaya', 'save', 'saves', 'locales', 'img', 'audio', 'movies', 'fonts'])
const HANDLED_DATA = new Set([...DB_SPECS.map(([file]) => file), 'System.json', 'CommonEvents.json', 'Troops.json', 'MapInfos.json', 'Animations.json', 'Tilesets.json'])

/** Return additional text resources only. Dedicated field and event parsers handle engine data, keeping scripts and developer notes out of game copy. */
export function* textResourceFiles(root: string, { fs, path }: NodeFiles): Generator<string> {
  function* walk(relative: string): Generator<string> {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name.toLowerCase()) && file !== 'js/libs') yield* walk(file)
      } else if (entry.isFile() && /\.(?:json|csv|txt)$/i.test(entry.name)) {
        if (entry.name === 'package.json' || /(?:trans\.seed|extract\.strings|extract\.compare)\.json$/i.test(entry.name)) continue
        if (relative === 'data' && (HANDLED_DATA.has(entry.name) || /^Map\d+\.json$/.test(entry.name))) continue
        yield file
      }
    }
  }
  yield* walk('')
}

/** Parse RFC 4180 quoted fields, escaped quotes and embedded line breaks. */
function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = !quoted
    } else if (!quoted && /[,\r\n]/.test(char)) {
      fields.push(field)
      field = ''
      if (char !== ',') {
        rows.push(fields)
        fields = []
        if (char === '\r' && text[i + 1] === '\n') i++
      }
    } else field += char
  }
  fields.push(field)
  rows.push(fields)
  return rows
}

export function extractTextResource(file: string, raw: string): string[] {
  const text = raw.replace(/^\uFEFF/, '')
  if (/\.json$/i.test(file)) {
    try {
      return extractPluginText(JSON.parse(text))
    } catch {
      return []
    }
  }
  if (/\.csv$/i.test(file)) {
    const rows = csvRows(text)
    const first = rows[0] || []
    const header = first.every((field) => /^[A-Za-z_][A-Za-z0-9_ ]*$/.test(field)) && first.some((field) => isTextField(field)) ? rows.shift() : undefined
    return [
      ...new Set(
        rows.flatMap((row) =>
          row.flatMap((entry, index) => {
            const field = header?.[index]
            if (field && isTechnicalField(field)) return []
            return extractPluginText(field ? { [field]: entry } : entry)
          })
        )
      ),
    ]
  }
  const entries = text.split(/\r?\n/)
  return [...new Set(entries.flatMap((entry) => extractPluginText(entry)))]
}
