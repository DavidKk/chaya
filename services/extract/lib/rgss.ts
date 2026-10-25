import fs from 'node:fs'
import path from 'node:path'

import { ensureGameContentDir, gameContentReadPath } from '@/lib/game/content-files'
import { fixKnownBadGameTermTranslation, lookupGameTerm } from '@/lib/translate/game-terms'
import { detectSourceLanguage, isSourceText, type SourceLanguageOption } from '@/lib/translate/source-text'
import { unpackAceArchive } from '@/services/game/rgss-archive'
import { getGameCacheContext } from '@/services/translate/game-cache-context'
import { createGameCoverage } from '@/services/translate/game-coverage'
import { loadRgssTranslationLookup, resolveRgssTranslationWithEngine } from '@/services/translate/game-lookup'
import { loadGameTranslationRecords } from '@/services/translate/game-records'
import { attachSeedFailures, writeSeedFailure } from '@/services/translate/seed-failures'

import { compareWithManual } from './compare'
import { extractDataFields } from './data-fields'
import { extractDialogueFromEvents } from './dialogue'
import { parseRubyMarshal, rubyToPlain, type RubyValue } from './rgss/marshal'
import { extractRgssScriptUiStrings, loadRgssScriptTranslationItems } from './rgss/script-strings'
import { loadRgssItems, loadRgssItemsAsync, writeRgssData } from './rgss/writeback'
import { ensureRgssSourcesIndex, rgssDataSignature, writeRgssSourcesIndex } from './rgss-sources-index'
import { clean, isUseful } from './text'

const DATABASE_FIELDS: Record<string, { fields: string[]; category: string }> = {
  actors: { fields: ['name', 'nickname', 'profile'], category: 'actors' },
  classes: { fields: ['name'], category: 'classes' },
  skills: { fields: ['name', 'description', 'message1', 'message2'], category: 'skills' },
  items: { fields: ['name', 'description'], category: 'items' },
  weapons: { fields: ['name', 'description'], category: 'weapons' },
  armors: { fields: ['name', 'description'], category: 'armors' },
  enemies: { fields: ['name'], category: 'enemies' },
  states: { fields: ['name', 'message1', 'message2', 'message3', 'message4'], category: 'states' },
}

function findChild(dir: string, name: string): string | null {
  try {
    const hit = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === name.toLowerCase())
    return hit ? path.join(dir, hit) : null
  } catch {
    return null
  }
}

export function rgssDataDir(contentRoot: string): string | null {
  const dir = findChild(contentRoot, 'data')
  if (dir && fs.statSync(dir).isDirectory() && extensionFor(dir)) return dir
  try {
    const names = fs.readdirSync(contentRoot)
    const archive = names.find((name) => /^game\.rgss3a$/i.test(name))
    if (archive) {
      unpackAceArchive(path.join(contentRoot, archive), contentRoot, (m: string) => m.toLowerCase().startsWith('data/'))
      const extracted = findChild(contentRoot, 'data')
      if (extracted && fs.statSync(extracted).isDirectory() && extensionFor(extracted)) return extracted
    }
  } catch {
    /* ignore */
  }
  return dir && fs.statSync(dir).isDirectory() ? dir : null
}

function extensionFor(dataDir: string): '.rvdata2' | '.rvdata' | null {
  try {
    const names = fs.readdirSync(dataDir).map((name) => name.toLowerCase())
    if (names.some((name) => name.endsWith('.rvdata2'))) return '.rvdata2'
    if (names.some((name) => name.endsWith('.rvdata'))) return '.rvdata'
  } catch {
    /* handled by caller */
  }
  return null
}

function loadRuby(file: string): RubyValue | null {
  try {
    const original = `${file}.chaya.bak`
    return parseRubyMarshal(fs.readFileSync(fs.existsSync(original) ? original : file))
  } catch (error) {
    console.warn(`[extract] Skipping invalid RGSS data ${file}:`, error instanceof Error ? error.message : error)
    return null
  }
}

function plain(value: RubyValue | null): any {
  return value == null ? null : rubyToPlain(value)
}

function objectValues(value: any): any[] {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean)
  return []
}

function fileFor(dataDir: string, stem: string, extension: string): string | null {
  const direct = path.join(dataDir, `${stem}${extension}`)
  if (fs.existsSync(direct)) return direct
  try {
    const hit = fs.readdirSync(dataDir).find((name) => name.toLowerCase() === `${stem}${extension}`.toLowerCase())
    return hit ? path.join(dataDir, hit) : null
  } catch {
    return null
  }
}

function extractDatabase(dataDir: string, extension: string): Record<string, unknown> {
  const db: Record<string, unknown> = {}
  for (const [stem, spec] of Object.entries(DATABASE_FIELDS)) {
    const file = fileFor(dataDir, stem[0]!.toUpperCase() + stem.slice(1), extension)
    const rows = file ? objectValues(plain(loadRuby(file))) : []
    const entries: Record<string, unknown>[] = []
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      if (!row || typeof row !== 'object') continue
      const entry: Record<string, unknown> = { id: row.id ?? index }
      let hasText = false
      for (const field of spec.fields) {
        const value = clean(row[field])
        if (!isUseful(value)) continue
        entry[field] = value
        hasText = true
      }
      if (hasText) entries.push(entry)
    }
    db[spec.category] = entries
  }
  return db
}

function eventLists(value: any): any[] {
  return objectValues(value).flatMap((event) => {
    const pages = objectValues(event?.pages)
    if (pages.length) return pages.map((page) => ({ list: objectValues(page?.list) }))
    return event?.list ? [{ list: objectValues(event.list) }] : []
  })
}

function loadDialogue(dataDir: string, extension: string) {
  const blocks: any[] = []
  const mapFiles = fs
    .readdirSync(dataDir)
    .filter((name) => /^map\d+$/i.test(name.slice(0, -extension.length)) && name.toLowerCase().endsWith(extension))
    .sort()
  for (const name of mapFiles) {
    const map = plain(loadRuby(path.join(dataDir, name)))
    const mapId = Number(name.match(/Map(\d+)/i)?.[1])
    const events = eventLists(map?.events)
    blocks.push(...extractDialogueFromEvents(events, { map: mapId }))
  }

  const common = fileFor(dataDir, 'CommonEvents', extension)
  if (common) blocks.push(...extractDialogueFromEvents(objectValues(plain(loadRuby(common))), { src: 'common' }))

  const troops = fileFor(dataDir, 'Troops', extension)
  if (troops) blocks.push(...extractDialogueFromEvents(eventLists(plain(loadRuby(troops))), { src: 'troop' }))
  return blocks
}

function extractSystem(dataDir: string, extension: string): string[] {
  const file = fileFor(dataDir, 'System', extension)
  if (!file) return []
  const value = plain(loadRuby(file))
  return extractDataFields(value, { knownOnly: true })
}

function listDataFiles(dataDir: string, extension: string): string[] {
  try {
    return fs
      .readdirSync(dataDir)
      .filter((name) => name.toLowerCase().endsWith(extension))
      .map((name) => path.join(dataDir, name))
  } catch {
    return []
  }
}

export function looksLikeRgssProject(contentRoot: string): boolean {
  const dataDir = rgssDataDir(contentRoot)
  if (dataDir && extensionFor(dataDir)) return true
  try {
    const names = fs.readdirSync(contentRoot).map((name) => name.toLowerCase())
    if (names.some((name) => name === 'game.rgss3a' || name === 'game.rgss2a' || name === 'game.rgssad')) {
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

export function runRgssExtract(contentRoot: string, options?: { sourceLanguage?: SourceLanguageOption }) {
  const dataDir = rgssDataDir(contentRoot)
  const extension = dataDir && extensionFor(dataDir)
  if (!dataDir || !extension) throw new Error(`RGSS Data/ directory not found: ${contentRoot}`)

  const dialogue = loadDialogue(dataDir, extension)
  const db = extractDatabase(dataDir, extension)
  db.system = extractSystem(dataDir, extension)
  const candidates = new Set<string>()
  for (const file of listDataFiles(dataDir, extension)) {
    const value = plain(loadRuby(file))
    for (const text of extractDataFields(value)) candidates.add(text)
  }
  db.dataFields = [...candidates]
  // Offline writeback uses whole Marshal string slots, not runtime sentence fragments.
  const knownSources = new Set([...loadRgssItems(dataDir).map((item) => item.src), ...extractRgssScriptUiStrings(contentRoot).map((item) => item.src)])
  const sourceLanguage = options?.sourceLanguage && options.sourceLanguage !== 'auto' ? options.sourceLanguage : detectSourceLanguage(knownSources, undefined)
  const allStrings = new Set([...knownSources].filter((text) => isSourceText(text, options?.sourceLanguage === 'auto' || !options?.sourceLanguage ? 'all' : sourceLanguage)))
  const originalStrings = new Set(allStrings)
  const counts: Record<string, number> = {
    dialogueBlocks: dialogue.length,
    dialogueLines: new Set(dialogue.flatMap((block) => block.lines || [])).size,
    dialogueChoices: new Set(dialogue.flatMap((block) => block.choices || [])).size,
    uniqueStrings: allStrings.size,
  }
  for (const [name, entries] of Object.entries(db)) counts[name] = Array.isArray(entries) ? entries.length : 0

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceLanguage,
      source: `Data/*.${extension.slice(1)} Ruby Marshal + RGSS event data`,
      note: 'RGSS/VX data is read without executing game scripts; encrypted archives must be unpacked by the user first.',
      counts,
    },
    dialogue,
    db,
  }
  const out = ensureGameContentDir(contentRoot, 'extractStrings')
  fs.writeFileSync(out, `${JSON.stringify(result)}\n`, 'utf8')
  let compare: Record<string, unknown> = { manualExists: false }
  const manual = gameContentReadPath(contentRoot, 'seed', { alsoParent: true })
  if (manual && fs.existsSync(manual)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(manual, 'utf8')) as Record<string, unknown>
      compare = compareWithManual(allStrings, dialogue, parsed)
    } catch {
      /* ignore malformed manual seed */
    }
  }
  const compareFile = ensureGameContentDir(contentRoot, 'extractCompare')
  fs.writeFileSync(compareFile, `${JSON.stringify(compare, null, 2)}\n`, 'utf8')
  return { OUT: out, COMPARE: compareFile, allStrings, originalStrings, dialogue, counts, compare }
}

export function writeRgssTranslations(contentRoot: string, translations: Record<string, string>) {
  const dataDir = rgssDataDir(contentRoot)
  if (!dataDir) throw new Error('RGSS Data/ directory not found')
  const result = writeRgssData(dataDir, translations)
  for (const src of Object.keys(translations)) writeSeedFailure(contentRoot, src, null)
  return result
}

function resolveRgssItemZh(src: string, current: string, translations: ReturnType<typeof loadRgssTranslationLookup>): { zh: string; engine?: string } {
  const resolved = resolveRgssTranslationWithEngine(src, current, translations)
  const termFixed = fixKnownBadGameTermTranslation(src, resolved.zh)
  if (termFixed != null) {
    return { zh: termFixed, engine: resolved.engine }
  }
  if (resolved.zh) return resolved
  const term = lookupGameTerm(src)
  if (term) return { zh: term, engine: 'cache' }
  return { zh: '', engine: undefined }
}

function attachLookup(contentRoot: string, dataItems: ReturnType<typeof loadRgssItems>) {
  const translations = loadRgssTranslationLookup(contentRoot)
  const { lookup } = translations
  const withZh = dataItems.map((item) => {
    const res = resolveRgssItemZh(item.src, item.zh || '', translations)
    return { ...item, zh: res.zh, engine: res.engine, savedZh: res.zh || undefined, initialZh: item.initialZh || res.zh || undefined }
  })
  const known = new Set(withZh.map((item) => item.src))
  const scriptItems = loadRgssScriptTranslationItems(contentRoot, lookup, withZh.length + 1)
    .filter((item) => !known.has(item.src))
    .map((item) => {
      const res = resolveRgssItemZh(item.src, item.zh || '', translations)
      return { ...item, zh: res.zh, engine: res.engine, savedZh: res.zh || undefined, initialZh: res.zh || undefined }
    })
  return attachCoverage(contentRoot, [...withZh, ...scriptItems])
}

async function attachLookupAsync(contentRoot: string, dataItems: ReturnType<typeof loadRgssItems>) {
  await new Promise<void>((r) => setTimeout(r, 0))
  const translations = loadRgssTranslationLookup(contentRoot)
  const { lookup } = translations
  await new Promise<void>((r) => setTimeout(r, 0))
  const withZh: ReturnType<typeof attachLookup> = []
  for (let i = 0; i < dataItems.length; i++) {
    const item = dataItems[i]!
    const res = resolveRgssItemZh(item.src, item.zh || '', translations)
    withZh.push({ ...item, zh: res.zh, engine: res.engine, savedZh: res.zh || undefined, initialZh: item.initialZh || res.zh || undefined })
    if (i % 200 === 199) await new Promise<void>((r) => setTimeout(r, 0))
  }
  await new Promise<void>((r) => setTimeout(r, 0))
  const known = new Set(withZh.map((item) => item.src))
  const scriptItems = loadRgssScriptTranslationItems(contentRoot, lookup, withZh.length + 1)
    .filter((item) => !known.has(item.src))
    .map((item) => {
      const res = resolveRgssItemZh(item.src, item.zh || '', translations)
      return { ...item, zh: res.zh, engine: res.engine, savedZh: res.zh || undefined, initialZh: res.zh || undefined }
    })
  return attachCoverage(contentRoot, [...withZh, ...scriptItems])
}

function attachCoverage(contentRoot: string, items: ReturnType<typeof loadRgssItems>) {
  const coverage = createGameCoverage(loadGameTranslationRecords(contentRoot), { blocked: getGameCacheContext(contentRoot).blocked })
  try {
    return attachSeedFailures(
      contentRoot,
      items.map((item) => {
        if (item.zh) return item
        const zh = coverage.resolve(item.src)
        return zh == null ? item : { ...item, zh, savedZh: zh, initialZh: zh, engine: 'cache' }
      })
    )
  } finally {
    coverage.close()
  }
}

export function loadRgssTranslationItems(contentRoot: string) {
  const dataDir = rgssDataDir(contentRoot)
  if (!dataDir) throw new Error('RGSS Data/ directory not found. Unpack the encrypted archive first.')
  const items = loadRgssItems(dataDir)
  try {
    writeRgssSourcesIndex(
      contentRoot,
      rgssDataSignature(dataDir),
      items.map((item) => item.src)
    )
  } catch {
    /* index is best-effort */
  }
  return attachLookup(contentRoot, items)
}

/** Same as loadRgssTranslationItems but yields between Data files so other APIs stay responsive. */
export async function loadRgssTranslationItemsAsync(contentRoot: string) {
  const dataDir = rgssDataDir(contentRoot)
  if (!dataDir) throw new Error('RGSS Data/ directory not found. Unpack the encrypted archive first.')
  const items = await loadRgssItemsAsync(dataDir)
  try {
    writeRgssSourcesIndex(
      contentRoot,
      rgssDataSignature(dataDir),
      items.map((item) => item.src)
    )
  } catch {
    /* index is best-effort */
  }
  return attachLookupAsync(contentRoot, items)
}

// Eligibility for old seeds follows the same slots as extraction/writeback. Do not delete
// cached text globally: a visible label can have the same spelling as an audio file.
const seedSources = new Map<string, { signature: string; sources: Set<string> }>()
export function filterRgssSeedKeys(contentRoot: string, keys: string[]): string[] {
  const dir = findChild(contentRoot, 'data')
  if (!dir || !extensionFor(dir)) return keys
  const signature = rgssDataSignature(dir)
  let entry = seedSources.get(contentRoot)
  if (entry?.signature !== signature) {
    const sources = ensureRgssSourcesIndex(contentRoot, dir, () => loadRgssItems(dir).map((item) => item.src))
    entry = { signature, sources }
    if (seedSources.size >= 20) seedSources.delete(seedSources.keys().next().value!)
    seedSources.set(contentRoot, entry)
  }
  const scripts = new Set(extractRgssScriptUiStrings(contentRoot).map((item) => item.src))
  return keys.filter((key) => entry!.sources.has(key) || scripts.has(key))
}
