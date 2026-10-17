import { isSourceText } from '@/lib/translate/source-text'

import { clean } from './text'

const TEXT_FIELD =
  /^(?:name|displayName|nickname|description|profile|message\d*|text|label|title|help|caption|summary|dialogue|.*[ _-](?:text|message|label|title|description|name|help))$/i
const TECH_FIELD =
  /^(?:.*(?:path|url|script|formula|texture)|file(?:name)?|code|eval|callback|handler|condition|expression|Battle Show List|mode|blendMode|spawnType|(?:character|battler|face|picture|animation\d*|battleback\d*|title\d*|parallax)Name|tilesetNames|bgm|bgs|se|me|audio|image|sound|parameters|params|meta|frames|data|flags|traits|effects|damage|timings)$/i

export const isTextField = (field: string) => TEXT_FIELD.test(field)
export const isTechnicalField = (field: string) => TECH_FIELD.test(field)

/** Notes contain both prose and executable plugin settings. Export prose, never tag names/config. */
export function extractNoteText(value: unknown): string[] {
  if (typeof value !== 'string') return []
  const withoutTags = value
    .replace(/<([A-Za-z_][\w -]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/g, (_, tag: string, body: string) =>
      /(?:script|code|eval|formula|custom.*(?:effect|condition|requirement|cost)|action\s*sequence)/i.test(tag) ? '' : body
    )
    .replace(/<(?:description|help|text|label|info|説明|表示名|ヘルプ)\s*[:：]\s*([^>]+)>/gi, '\n$1\n')
    .replace(/<[^>\r\n]*>/g, '')
  return withoutTags
    .split(/\r?\n/)
    .map(clean)
    .filter((line) => isSourceText(line) && !/^[^:：\n]+[:：]\s*(?:[-+\d.,%\s]+|true|false|on|off)$/i.test(line))
}

/** Collect unknown text too; callers can take a first pass of known fields for queue priority. */
export function extractDataFields(value: unknown, options?: { knownOnly?: boolean }): string[] {
  const found = new Set<string>()
  let visited = 0
  const walk = (entry: unknown, field: string, depth: number) => {
    if (++visited > 200_000 || depth > 24 || TECH_FIELD.test(field)) return
    if (Array.isArray(entry)) {
      for (const child of entry) walk(child, field, depth + 1)
    } else if (entry && typeof entry === 'object') {
      for (const [key, child] of Object.entries(entry)) walk(child, key, depth + 1)
    } else if (typeof entry === 'string') {
      if (field === 'note') for (const line of extractNoteText(entry)) found.add(line)
      else if ((!options?.knownOnly || TEXT_FIELD.test(field)) && isSourceText(entry)) found.add(clean(entry))
    }
  }
  walk(value, '', 0)
  return [...found]
}
