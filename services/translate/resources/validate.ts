import { canonicalResourceLanguage, type ResourcePack } from '@/lib/translate/resource-types'
import { controlSignature } from '@/lib/translate/sentence-units'

export const RESOURCE_LIMITS = { bytes: 700_000, records: 1000, lineLength: 32_000 }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 16000): value is string => typeof value === 'string' && !!value.trim() && value.length <= max
const identifier = (value: unknown) => text(value, 100) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
function fail(message: string): never {
  throw new TypeError(message)
}
function placeholders(value: string) {
  return JSON.stringify([controlSignature(value), value.match(/%(?:\d+\$)?[-+#0 ]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[sdifouxXeEgGc%]/g) || []])
}

/** No executable patterns, silent coercions or partially accepted packages. */
export function parseResourcePack(input: string): ResourcePack {
  if (Buffer.byteLength(input, 'utf8') > RESOURCE_LIMITS.bytes) fail('Resource package exceeds size limit')
  const lines = input.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 1 || lines.length > RESOURCE_LIMITS.records + 1) fail('Invalid resource record count')
  const rows = lines.map((line, index): Record<string, unknown> => {
    if (line.length > RESOURCE_LIMITS.lineLength) fail(`Resource line ${index + 1} is too long`)
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return fail(`Invalid JSON at resource line ${index + 1}`)
    }
    if (!object(value)) fail(`Invalid object at resource line ${index + 1}`)
    const queue: Array<[unknown, number]> = [[value, 0]]
    while (queue.length) {
      const [item, depth] = queue.pop()!
      if (depth > 16) fail('Resource nesting limit exceeded')
      if (item && typeof item === 'object') for (const child of Object.values(item)) queue.push([child, depth + 1])
    }
    return value
  })
  const [manifest, ...records] = rows
  if (manifest.type !== 'manifest' || manifest.schemaVersion !== 1 || !identifier(manifest.packId) || !identifier(manifest.version)) fail('Invalid resource manifest')
  if (!Array.isArray(manifest.languages) || manifest.languages.length > 100) fail('Invalid resource languages')
  const languages = new Set<string>()
  for (const language of manifest.languages) {
    if (!object(language) || !text(language.tag, 100) || !text(language.name, 100)) fail('Invalid resource language')
    if (canonicalResourceLanguage(language.tag) !== language.tag || languages.has(language.tag)) fail('Languages must be canonical and unique')
    languages.add(language.tag)
  }
  const ids = new Set<string>()
  for (const record of records) {
    if (!identifier(record.entryId) || ids.has(String(record.entryId))) fail('Invalid or duplicate resource entry ID')
    ids.add(String(record.entryId))
    for (const field of ['sourceLanguage', 'targetLanguage']) {
      if (!text(record[field], 100) || canonicalResourceLanguage(record[field]) !== record[field]) fail('Invalid resource language pair')
    }
    if (!object(record.scope) || !['global', 'game'].includes(String(record.scope.kind)) || (record.scope.kind === 'game' && !text(record.scope.gameId, 200)))
      fail('Invalid resource scope')
    if (!['candidate', 'reviewed'].includes(String(record.reviewStatus)) || !object(record.provenance) || !text(record.provenance.kind, 100)) fail('Invalid resource provenance')
    if (
      record.conditions !== undefined &&
      (!object(record.conditions) || Object.entries(record.conditions).some(([name, value]) => !['category', 'speaker', 'scene'].includes(name) || !text(value, 200)))
    )
      fail('Invalid resource conditions')
    if (record.type === 'entry') {
      if (!text(record.sourceText) || !text(record.targetText) || !object(record.match) || record.match.kind !== 'exact') fail('Invalid exact resource entry')
      if (record.match.allowBoundary !== undefined && typeof record.match.allowBoundary !== 'boolean') fail('Invalid boundary matching flag')
      for (const name of ['aliases', 'badTranslations']) {
        const values = record[name]
        if (values !== undefined && (!Array.isArray(values) || values.length > 100 || values.some((value) => !text(value)))) fail(`Invalid ${name}`)
      }
      for (const source of [record.sourceText, ...((record.aliases as string[] | undefined) || [])]) {
        if (placeholders(source) !== placeholders(record.targetText)) fail('Resource controls or placeholders differ')
      }
    } else if (record.type === 'vocal_rule') {
      if (record.templateKind !== 'vocal-sequence' || !object(record.units) || !object(record.modifiers)) fail('Invalid vocal template')
      const units = Object.entries(record.units)
      if (
        !units.length ||
        units.length > 100 ||
        units.some(([unit, target]) => !text(unit, 40) || !/^\p{L}[\p{L}\p{M}]*$/u.test(unit) || unit.normalize('NFC') !== unit || !text(target, 100) || /[\\%{}<>]/.test(target))
      )
        fail('Invalid vocal units')
      const modifiers = record.modifiers
      if (
        !Array.isArray(modifiers.punctuation) ||
        modifiers.punctuation.length > 100 ||
        modifiers.punctuation.some((mark) => typeof mark !== 'string' || !mark.length || mark.length > 20 || !/^[\p{P}\p{Zs}]+$/u.test(mark) || /[\\%{}<>[\]]/.test(mark))
      )
        fail('Invalid vocal punctuation')
      if (
        ![modifiers.minUnits, modifiers.maxUnits, modifiers.maxInputLength].every(Number.isSafeInteger) ||
        Number(modifiers.minUnits) < 1 ||
        Number(modifiers.maxUnits) < Number(modifiers.minUnits) ||
        Number(modifiers.maxUnits) > 256 ||
        Number(modifiers.maxInputLength) < 1 ||
        Number(modifiers.maxInputLength) > 512
      )
        fail('Invalid vocal bounds')
    } else fail('Unknown resource record type')
  }
  return { manifest, records } as unknown as ResourcePack
}

export function serializeResourcePack(pack: ResourcePack): string {
  return [pack.manifest, ...pack.records].map((record) => JSON.stringify(record)).join('\n') + '\n'
}
