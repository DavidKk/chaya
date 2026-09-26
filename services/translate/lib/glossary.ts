// @ts-nocheck
import { path, rt } from './env'
import { TOKEN } from './constants'
import { hasJapanese, isOnlyPunctuation, loadJson, peelNoise, translateVoiceOnlyLine, wrapNoise, classifyTerm } from './text-cache'

export function readDbNames(file, fields) {
  const rows = loadJson(path.join(rt().P.DATA, file), []) || []
  const out = []
  for (const row of rows) {
    if (!row) continue
    for (const field of fields) {
      const value = String(row[field] ?? '')
        .trim()
        .replace(/^#/, '')
      if (value) out.push(value)
    }
  }
  return out
}

export function loadGlossaryEntries() {
  const buckets = [
    ['name', readDbNames('Actors.json', ['name', 'nickname']), 2],
    ['enemy', readDbNames('Enemies.json', ['name']), 3],
    ['skill', readDbNames('Skills.json', ['name']), 2],
    ['item', readDbNames('Items.json', ['name']), 2],
    ['weapon', readDbNames('Weapons.json', ['name']), 2],
    ['armor', readDbNames('Armors.json', ['name']), 2],
    ['state', readDbNames('States.json', ['name']), 2],
  ]

  const seen = new Set()
  const entries = []
  for (const [type, values, minLen] of buckets) {
    const token = TOKEN[type]
    for (const jp of values) {
      if (!jp || seen.has(jp)) continue
      if (!hasJapanese(jp) || isOnlyPunctuation(jp)) continue
      if (jp.length < minLen) continue
      // 太泛的短词不做占位，避免误伤
      if (jp.length <= 2 && !['name'].includes(type)) continue
      seen.add(jp)
      entries.push({ jp, type, token })
    }
  }
  entries.sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp))
  return entries
}

export function maskGlossary(text, entries) {
  let masked = String(text)
  const slots = []
  for (const entry of entries) {
    if (!entry.jp || !masked.includes(entry.jp)) continue
    while (masked.includes(entry.jp)) {
      slots.push(entry)
      masked = masked.replace(entry.jp, entry.token)
    }
  }
  return { masked, slots }
}

export function unmaskGlossary(text, slots, zhMap) {
  let out = String(text ?? '')
  for (const slot of slots) {
    if (!out.includes(slot.token)) continue
    out = out.replace(slot.token, zhMap[slot.jp] || slot.jp)
  }
  return out
}

// 称呼：占位后只剩这些 + 标点/口吃时，可本地拼接，不必再送 API
const HONORIFICS = [
  ['先生', '老师'],
  ['さん', ''],
  ['ちゃん', ''],
  ['くん', ''],
  ['君', ''],
  ['様', '大人'],
  ['殿', '大人'],
  ['氏', ''],
]

/**
 * 词表占位后，若只剩称呼/标点/短口吃（ア、），本地拼出译文，跳过 API。
 * 例如：ア、アルマ先生……！ → 阿、阿尔玛老师……！
 */
export function tryComposeGlossaryShell(src, entries, zhMap) {
  const { core, prefix, suffix } = peelNoise(src)
  const { masked, slots } = maskGlossary(core, entries)
  if (!slots.length) return null

  let work = masked
  for (const [jp] of HONORIFICS) {
    work = work.split(jp).join('\0H\0')
  }
  for (const token of Object.values(TOKEN)) {
    work = work.split(token).join('\0T\0')
  }

  const leftover = work.replace(/\0H\0|\0T\0/g, '').replace(/[「」『』""''“”‘’（）()【】\[\]\s\u3000…！!？?、。｡･・～〜ー\-♡♥]/g, '')

  // 允许极短口吃假名（ア、イ、あ…），不允许其它实词残留
  if (leftover && !/^[ぁ-んァ-ン]{1,4}$/u.test(leftover)) return null

  let out = masked
  for (const slot of slots) {
    out = out.split(slot.token).join(zhMap[slot.jp] || slot.jp)
  }
  for (const [jp, zh] of HONORIFICS) {
    out = out.split(jp).join(zh)
  }

  out = translateVoiceOnlyLine(out)
  out = out.trim()
  if (!out) return null
  return wrapNoise(out, prefix, suffix)
}

/**
 * 把缓存里已译好的短词条并进词表，便于「アルマ先生」这类占位。
 */
export function enrichGlossaryFromSeed(entries, seed, tokenizer) {
  const seen = new Set(entries.map((e) => e.jp))
  const extra = []
  for (const [jp, zh] of Object.entries(seed)) {
    if (!jp || seen.has(jp)) continue
    if (!hasJapanese(jp) || isOnlyPunctuation(jp)) continue
    if (jp.length < 2 || jp.length > 16) continue
    if (!zh || zh === jp) continue
    // 只要短词条；有助词的句子不要当人名
    const info = classifyTerm(tokenizer, jp)
    if (info.kind !== 'term') continue
    seen.add(jp)
    extra.push({ jp, type: 'name', token: TOKEN.name })
  }
  if (!extra.length) return entries
  const merged = entries.concat(extra)
  merged.sort((a, b) => b.jp.length - a.jp.length || a.jp.localeCompare(b.jp))
  return merged
}

export function remaskGlossaryFilled(text, slots, zhMap) {
  let out = String(text ?? '')
  for (const slot of slots) {
    const zh = zhMap[slot.jp] || slot.jp
    if (out.includes(zh)) out = out.replace(zh, slot.token)
    else if (out.includes(slot.jp)) out = out.replace(slot.jp, slot.token)
  }
  return out
}
