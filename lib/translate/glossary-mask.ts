/**
 * 词表占位（专名 → __NAME__ 等）：Seed 与局内查表共用。
 * 只替换游戏 DB 里的封闭专名，不做开放式主语抽取。
 */

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
  // 长词优先，避免「ボブ」先吃掉「キャロル」里的误匹配，以及短名抢在长名前面
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

/** 把已填专名的译文重新打回占位，便于按模板键存储。 */
export function remaskGlossaryFilled(text: string, slots: readonly GlossaryEntry[], zhMap: Record<string, string>): string {
  let out = String(text ?? '')
  for (const slot of slots) {
    const zh = zhMap[slot.jp] || slot.jp
    if (out.includes(zh)) out = out.replace(zh, slot.token)
    else if (out.includes(slot.jp)) out = out.replace(slot.jp, slot.token)
  }
  return out
}

/** 用模板译文 + 当前句槽位还原；命中则返回译文。 */
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

/** 写入缓存时登记模板键。 */
export function indexGlossaryTemplate(templateZh: Map<string, string>, src: string, zh: string, entries: readonly GlossaryEntry[], zhMap: Record<string, string>) {
  if (!entries.length) return
  const { masked, slots } = maskGlossary(src, entries)
  if (!slots.length) return
  const maskedZh = remaskGlossaryFilled(zh, slots, zhMap)
  if (!maskedZh || maskedZh === masked) return
  templateZh.set(masked, maskedZh)
}
