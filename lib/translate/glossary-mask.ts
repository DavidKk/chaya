/** Glossary placeholders for proper names, shared by seed processing and in-game lookup. Replace only names from the game's database; do not infer arbitrary subjects. */

export const GLOSSARY_TOKEN = {
  name: '__NAME__',
  item: '__ITEM__',
  skill: '__SKILL__',
  weapon: '__WEAPON__',
  armor: '__ARMOR__',
  state: '__STATE__',
  enemy: '__ENEMY__',
} as const

export type GlossaryTokenType = keyof typeof GLOSSARY_TOKEN

export type GlossaryEntry = {
  jp: string
  type: GlossaryTokenType
  token: string
}

export function maskGlossary(text: string, entries: readonly GlossaryEntry[]): { masked: string; slots: GlossaryEntry[] } {
  let masked = String(text)
  const slots: GlossaryEntry[] = []
  // Match longer names first so shorter names cannot consume part of a longer name.
  const ordered = [...entries].sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp))
  for (const entry of ordered) {
    if (!entry.jp || !masked.includes(entry.jp)) continue
    while (masked.includes(entry.jp)) {
      slots.push(entry)
      masked = masked.replace(entry.jp, entry.token)
    }
  }
  return { masked, slots }
}

export function unmaskGlossary(text: string, slots: readonly GlossaryEntry[], zhMap: Record<string, string>): string {
  let out = String(text ?? '')
  for (const slot of slots) {
    if (!out.includes(slot.token)) continue
    out = out.replace(slot.token, zhMap[slot.jp] || slot.jp)
  }
  return out
}

/** Mask translated names again so the result can be stored under a template key. */
export function remaskGlossaryFilled(text: string, slots: readonly GlossaryEntry[], zhMap: Record<string, string>): string {
  let out = String(text ?? '')
  for (const slot of slots) {
    const zh = zhMap[slot.jp] || slot.jp
    if (out.includes(zh)) out = out.replace(zh, slot.token)
    else if (out.includes(slot.jp)) out = out.replace(slot.jp, slot.token)
  }
  return out
}

/** Restore a template translation with the current sentence's slot values; return the translation on a match. */
export function translateByGlossaryTemplate(
  text: string,
  entries: readonly GlossaryEntry[],
  zhMap: Record<string, string>,
  templateZh: ReadonlyMap<string, string>
): string | null {
  if (!entries.length) return null
  const { masked, slots } = maskGlossary(text, entries)
  if (!slots.length) return null
  const hit = templateZh.get(masked)
  if (hit == null || hit === '') return null
  return unmaskGlossary(hit, slots, zhMap)
}

/** Index template keys when writing cache entries. */
export function indexGlossaryTemplate(templateZh: Map<string, string>, src: string, zh: string, entries: readonly GlossaryEntry[], zhMap: Record<string, string>) {
  if (!entries.length) return
  const { masked, slots } = maskGlossary(src, entries)
  if (!slots.length) return
  const maskedZh = remaskGlossaryFilled(zh, slots, zhMap)
  if (!maskedZh || maskedZh === masked) return
  templateZh.set(masked, maskedZh)
}
