import fs from 'node:fs'
import path from 'node:path'

import { isNameGlossaryCategory } from '@/lib/translate/name-glossary'
import { isSourceText } from '@/lib/translate/source-text'

import { isTechnicalField, isTextField } from '../data-fields'
import type { ExtractedTextCategory, ExtractedTranslationItem } from '../extract-items'
import { assertExtendedChoiceTranslation, parseRgssExtendedChoices } from './extended-choices'
import { parseRubyMarshal, type RubyArray, rubyObjectField, type RubyString, type RubyValue, writeRubyMarshal } from './marshal'

type StringSlot = { value: RubyString; set: (value: RubyString) => void; category: ExtractedTextCategory }
type TextLocation = { source: string; current: StringSlot; file: string; location: string }
type DataFile = { file: string; value: RubyValue; texts: TextLocation[] }

function translatedString(source: RubyString, value: string): RubyString {
  const next: RubyString = { kind: 'string', value }
  if (source.ivars) {
    next.ivars = {
      kind: 'hash',
      pairs: source.ivars.pairs.filter((pair) => !(pair.key && typeof pair.key === 'object' && pair.key.kind === 'symbol' && ['E', 'encoding'].includes(pair.key.value))),
    }
    next.ivars.pairs.push({ key: { kind: 'symbol', value: 'E' }, value: true })
  }
  return next
}

function commentCommand(value: RubyValue) {
  if (!value || typeof value !== 'object' || value.kind !== 'object' || value.className !== 'RPG::EventCommand') return null
  const code = rubyObjectField(value, 'code')
  const parameters = rubyObjectField(value, 'parameters')
  if ((code !== 108 && code !== 408) || !parameters || typeof parameters !== 'object' || parameters.kind !== 'array') return null
  const text = parameters.items[0]
  return text && typeof text === 'object' && text.kind === 'string' ? { code, parameters, text } : null
}

/** Virtual choice slots share a comment block; reassemble all edits before splitting it back into the same commands. */
function extendedChoiceSlots(list: RubyArray, slot: string, result: Map<string, StringSlot>) {
  for (let i = 0; i < list.items.length; i++) {
    const first = commentCommand(list.items[i]!)
    if (first?.code !== 108) continue
    const start = i
    const comments = [first]
    while (i + 1 < list.items.length) {
      const next = commentCommand(list.items[i + 1]!)
      if (next?.code !== 408) break
      comments.push(next)
      i++
    }
    const raw = comments.map((comment) => comment.text.value).join('')
    const choices = parseRgssExtendedChoices(raw)
    if (!choices) continue
    const values = choices.map((choice): RubyString => ({ kind: 'string', value: choice.text }))
    const lengths = comments.map((comment) => comment.text.value.length)
    for (const [index, choice] of choices.entries()) {
      result.set(`${slot}/${start}/choice/${index}`, {
        get value() {
          return values[index]!
        },
        category: 'choice',
        set(next) {
          assertExtendedChoiceTranslation(choice.text, next.value)
          values[index] = next
          let text = ''
          let offset = 0
          for (const [j, span] of choices.entries()) {
            text += raw.slice(offset, span.start) + values[j]!.value
            offset = span.end
          }
          text += raw.slice(offset)
          offset = 0
          comments.forEach((comment, j) => {
            let end = j === comments.length - 1 ? text.length : Math.min(offset + lengths[j]!, text.length)
            // Marshal encodes each fragment separately; keep surrogate pairs in the same fragment.
            if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? '') && /[\uDC00-\uDFFF]/.test(text[end]!)) end--
            comment.parameters.items[0] = translatedString(comment.text, text.slice(offset, end))
            offset = end
          })
        },
      })
    }
  }
}

/** Paths refer to Marshal slots in the first-write backup, never translated text. */
function strings(value: RubyValue): Map<string, StringSlot> {
  const result = new Map<string, StringSlot>()
  const seen = new WeakSet<object>()
  const walk = (entry: RubyValue, slot: string, text: boolean, set: StringSlot['set'], category: ExtractedTextCategory = 'other') => {
    if (!entry || typeof entry !== 'object') return
    if (entry.kind === 'string') {
      if (text) result.set(slot, { value: entry, set, category })
      return
    }
    if (seen.has(entry)) return
    seen.add(entry)
    if (entry.kind === 'array') {
      extendedChoiceSlots(entry, slot, result)
      entry.items.forEach((child, index) =>
        walk(
          child,
          `${slot}/${index}`,
          text,
          (next) => {
            entry.items[index] = next
          },
          category
        )
      )
    } else if (entry.kind === 'hash') {
      entry.pairs.forEach((pair, index) => {
        const name = pair.key && typeof pair.key === 'object' && (pair.key.kind === 'symbol' || pair.key.kind === 'string') ? pair.key.value : ''
        walk(
          pair.value,
          `${slot}/h${index}`,
          !isTechnicalField(name) && (text || isTextField(name)),
          (next) => {
            pair.value = next
          },
          category
        )
      })
    } else if (entry.kind === 'object') {
      // Audio names are resource identifiers even when nested under System or animations.
      if (/^RPG::(?:AudioFile|BGM|BGS|ME|SE)$/.test(entry.className)) return
      const command = entry.className === 'RPG::EventCommand'
      const code = command ? rubyObjectField(entry, 'code') : null
      entry.ivars.pairs.forEach((pair, index) => {
        const name = pair.key && typeof pair.key === 'object' && pair.key.kind === 'symbol' ? pair.key.value.replace(/^@/, '') : ''
        if (command) {
          if (name !== 'parameters' || !pair.value || typeof pair.value !== 'object' || pair.value.kind !== 'array') return
          const parameter = code === 401 || code === 405 || code === 102 ? 0 : code === 402 || code === 320 || code === 324 || code === 325 ? 1 : -1
          const child = pair.value.items[parameter]
          const parameters = pair.value
          if (child !== undefined)
            walk(
              child,
              `${slot}/o${index}/${parameter}`,
              true,
              (next) => {
                parameters.items[parameter] = next
              },
              code === 102 || code === 402 ? 'choice' : 'dialogue'
            )
        } else {
          if (name === 'name' && ['RPG::Event', 'RPG::CommonEvent', 'RPG::Troop', 'RPG::Animation', 'RPG::Tileset'].includes(entry.className)) return
          if (/^(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)_name$/i.test(name)) return
          const systemText = /^(?:terms|words|basic|params|etypes|commands|elements|skill_types|weapon_types|armor_types|currency_unit|game_title)$/i.test(name)
          walk(
            pair.value,
            `${slot}/o${index}`,
            (systemText || !isTechnicalField(name)) && (isTextField(name) || systemText || text),
            (next) => {
              pair.value = next
            },
            fieldCategory(entry.className, name, category)
          )
        }
      })
    }
  }
  walk(value, '', false, () => {})
  return result
}

function fieldCategory(className: string, field: string, fallback: ExtractedTextCategory): ExtractedTextCategory {
  const base: Record<string, ExtractedTextCategory> = {
    'RPG::Actor': 'actor',
    'RPG::Item': 'item',
    'RPG::Weapon': 'weapon',
    'RPG::Armor': 'armor',
    'RPG::Skill': 'skill',
    'RPG::Enemy': 'enemy',
    'RPG::State': 'state',
    'RPG::Map': 'map',
    'RPG::MapInfo': 'map',
    'RPG::System': 'system',
  }
  if (className === 'RPG::Actor' && field === 'nickname') return 'actor_nickname'
  if (className === 'RPG::Actor' && (field === 'profile' || field === 'description')) return 'actor_profile'
  const category = base[className] ?? fallback
  if (field === 'description' && (category === 'item' || category === 'weapon' || category === 'armor' || category === 'skill')) return `${category}_desc`
  if (category === 'state' && /^message/.test(field)) return 'state_msg'
  return category
}

function loadOneDataFile(dataDir: string, name: string): DataFile {
  const file = path.join(dataDir, name)
  // Fail the request before writing anything if any file cannot be decoded.
  const value = parseRubyMarshal(fs.readFileSync(file))
  const backup = `${file}.chaya.bak`
  const original = fs.existsSync(backup) ? parseRubyMarshal(fs.readFileSync(backup)) : value
  const current = strings(value)
  const texts: TextLocation[] = []
  for (const [location, source] of strings(original)) {
    if (!isSourceText(source.value.value)) continue
    const target = current.get(location)
    if (!target) throw new Error(`RGSS data structure changed since backup: ${name}${location}`)
    texts.push({ source: source.value.value.trim(), current: target, file: name, location })
  }
  return { file, value, texts }
}

/** Custom / binary-heavy Data stems that are not translation sources (Marshal walk can hang). */
const SKIP_DATA_STEMS = /^(?:FileSystem|Animations|Tilesets)(?:\.|$)/i

function listDataFileNames(dataDir: string): string[] {
  const names = fs
    .readdirSync(dataDir)
    .filter((name) => /\.rvdata2?$/i.test(name) && !SKIP_DATA_STEMS.test(name))
    .sort()
  if (!names.length) throw new Error('RGSS data is unavailable. Unpack the encrypted archive into Data/ first.')
  return names
}

function loadFiles(dataDir: string): DataFile[] {
  return listDataFileNames(dataDir).map((name) => loadOneDataFile(dataDir, name))
}

/** Yield after every file so HTTP (status/progress) can run between Marshal parses. */
async function loadFilesAsync(dataDir: string): Promise<DataFile[]> {
  const names = listDataFileNames(dataDir)
  const out: DataFile[] = []
  for (let i = 0; i < names.length; i++) {
    out.push(loadOneDataFile(dataDir, names[i]!))
    // Prefer timer yield over setImmediate so pending HTTP callbacks get a turn on large trees.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  return out
}

function atomicWrite(file: string, bytes: Uint8Array) {
  const temporary = fs.mkdtempSync(path.join(path.dirname(file), '.chaya-rgss-'))
  try {
    const target = path.join(temporary, path.basename(file))
    fs.writeFileSync(target, bytes, { mode: fs.statSync(file).mode })
    fs.renameSync(target, file)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

function itemsFromFiles(files: DataFile[]): ExtractedTranslationItem[] {
  const groups = new Map<string, TextLocation[]>()
  for (const file of files) {
    for (const text of file.texts) {
      const group = groups.get(text.source) ?? []
      group.push(text)
      groups.set(text.source, group)
    }
  }
  return [...groups].map(([src, locations], index) => {
    const translated = locations.every((item) => item.current.value.value === locations[0]!.current.value.value) ? locations[0]!.current.value.value : ''
    const zh = translated.trim() !== src ? translated : ''
    return {
      id: String(index + 1),
      src,
      zh,
      savedZh: zh || undefined,
      initialZh: zh || undefined,
      meta: { category: locations[0]!.current.category, label: 'RGSS', file: `Data/${locations[0]!.file}` },
    }
  })
}

export function loadRgssItems(dataDir: string): ExtractedTranslationItem[] {
  return itemsFromFiles(loadFiles(dataDir))
}

/** Database name fields only; map events and scripts never contribute glossary authority. */
export function loadRgssNameItems(dataDir: string): ExtractedTranslationItem[] {
  const files = listDataFileNames(dataDir)
    .filter((name) => /^(?:Actors|Items|Weapons|Armors|Skills|Enemies|States|MapInfos)\.rvdata2?$/i.test(name))
    .map((name) => loadOneDataFile(dataDir, name))
  return itemsFromFiles(files).filter((item) => isNameGlossaryCategory(item.meta.category))
}

/**
 * Yielding parse for non-HTTP callers.
 * `/translate/list` offloads via `list-extract-prepare` + `runWorkerOnce` (contentRoot file IPC).
 */
export async function loadRgssItemsAsync(dataDir: string): Promise<ExtractedTranslationItem[]> {
  return itemsFromFiles(await loadFilesAsync(dataDir))
}

/** Copy every Data/*.rvdata(2).chaya.bak over the live file (no-op when no backup). */
export function restoreRgssFromBackup(dataDir: string): { restored: number; backups: number } {
  let restored = 0
  let backups = 0
  for (const name of fs.readdirSync(dataDir)) {
    if (!/\.rvdata2?$/i.test(name)) continue
    const file = path.join(dataDir, name)
    const backup = `${file}.chaya.bak`
    if (!fs.existsSync(backup)) continue
    backups += 1
    fs.copyFileSync(backup, file)
    restored += 1
  }
  return { restored, backups }
}

export function writeRgssData(dataDir: string, translations: Record<string, string>) {
  const entries = Object.entries(translations)
  if (!entries.length || entries.some(([source, target]) => !source.trim() || typeof target !== 'string' || !target.trim())) {
    throw new Error('RGSS writeback requires non-empty source texts and translations')
  }
  const files = loadFiles(dataDir)
  const known = new Set(files.flatMap((file) => file.texts.map((text) => text.source)))
  const missing = entries.map(([source]) => source).filter((source) => !known.has(source))
  if (missing.length) throw new Error(`RGSS source not found; reload the translation list: ${missing.join(', ')}`)
  const prepared: Array<{ file: string; bytes: Uint8Array; before: Uint8Array; replacements: number }> = []
  let matched = 0
  for (const file of files) {
    let replacements = 0
    for (const text of file.texts) {
      if (!Object.hasOwn(translations, text.source)) continue
      matched += 1
      const target = translations[text.source]!
      if (text.current.value.value === target) continue
      // Ruby 1.9 strings must advertise the encoding of the new UTF-8 bytes.
      text.current.set(translatedString(text.current.value, target))
      replacements += 1
    }
    if (replacements) prepared.push({ file: file.file, bytes: writeRubyMarshal(file.value), before: fs.readFileSync(file.file), replacements })
  }
  let backupCreated = false
  for (const item of prepared) {
    const backup = `${item.file}.chaya.bak`
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(item.file, backup, fs.constants.COPYFILE_EXCL)
      backupCreated = true
    }
  }
  const committed: typeof prepared = []
  try {
    for (const item of prepared) {
      atomicWrite(item.file, item.bytes)
      committed.push(item)
    }
  } catch (error) {
    const failed: string[] = []
    for (const item of committed.reverse()) {
      try {
        atomicWrite(item.file, item.before)
      } catch {
        failed.push(item.file)
      }
    }
    if (failed.length) throw new Error(`RGSS writeback failed; restore these files from .chaya.bak: ${failed.join(', ')}`)
    throw error
  }
  return { files: prepared.length, replacements: prepared.reduce((sum, file) => sum + file.replacements, 0), matched, backupCreated }
}
