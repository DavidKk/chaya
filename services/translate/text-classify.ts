/**
 * 送翻判定与 RM/脚本「壳」保护。
 * 控制码、`%1`、装饰符、选项 `if()`/`en()` 等抽出不译；首尾纯壳剥离后只送中间日文。
 */

import { peelChoiceMetaTrail } from '@/lib/translate/choice-meta'

// 只识别假名文字；「・」「ー」及全角/半角标点可原样保留在中文译文中。
const JAPANESE = /[\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FD-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/
const HAN = /[\u4e00-\u9fff]/

export function containsJapaneseText(text: string): boolean {
  return JAPANESE.test(String(text ?? ''))
}

function retainsJapaneseHanPhrase(src: string, zh: string): boolean {
  if (!containsJapaneseText(src)) return false
  return (src.match(/[\u4e00-\u9fff]{3,}/g) || []).some((phrase) => zh.includes(phrase))
}

/**
 * 抽出不译的 token：
 * - RPG Maker：`\C[16]` `\n[1]` `\I[1]` `\FS[20]` … / `\.` `\|` / `\[xxx]`
 * - `C[16]`、`_ABL`
 * - `%1` `%s` `{0}`
 * - `♡♥…` 等装饰符（连续）
 *
 * 送翻换成 `__C0__`；数字码跨句复用见 `lib/translate/rm-escape`（`\n[#]` 模板）。
 */
const PROTECT_TOKEN =
  /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|%[0-9]+|%[sdifSc]|\{[0-9A-Za-z_]+\}|[A-Za-z_][A-Za-z0-9_]*\[\d+\]|_[A-Z][A-Z0-9_]{1,}|[♡♥❤❥💕♪☆★✦✧※]{1,}|(?:\.{3}|…{1,}|・{2,}|･{2,})/g

/**
 * 词条首尾「标记壳」：技能/道具名常见前缀 `!` `!#`、感叹号、装饰符等。
 * 只在首尾剥（不进正文中部占位），避免误伤句中标点。
 */
const EDGE_MARK_RE = /^[!！？?#＃※＊*◆◇★☆▶▷▪▫・･「」『』【】]+/

function matchEdgeMarkAt(text: string, atEnd: boolean): string | null {
  if (!atEnd) {
    const m = text.match(EDGE_MARK_RE)
    return m ? m[0] : null
  }
  /* 从末尾剥同一类字符 */
  const m = text.match(/[!！？?#＃※＊*◆◇★☆▶▷▪▫・･「」『』【】]+$/)
  return m ? m[0] : null
}

function matchTokenAt(text: string, atEnd: boolean): string | null {
  PROTECT_TOKEN.lastIndex = 0
  let hit: string | null = null
  for (const m of text.matchAll(PROTECT_TOKEN)) {
    const i = m.index ?? 0
    if (atEnd) {
      if (i + m[0].length === text.length) hit = m[0]
    } else if (i === 0) {
      return m[0]
    }
  }
  return hit
}

function normCmp(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** 剥掉首尾连续的控制码 / 标记壳 / 占位 / 装饰 / 空白，只留中间正文。 */
export function peelProtectShell(text: string): { lead: string; core: string; trail: string } {
  let rest = String(text ?? '')
  let lead = ''
  let trail = ''

  for (;;) {
    const space = rest.match(/^[\s\u3000]+/)
    if (space) {
      lead += space[0]
      rest = rest.slice(space[0].length)
      continue
    }
    const mark = matchEdgeMarkAt(rest, false)
    if (mark) {
      lead += mark
      rest = rest.slice(mark.length)
      continue
    }
    const tok = matchTokenAt(rest, false)
    if (!tok) break
    lead += tok
    rest = rest.slice(tok.length)
  }

  for (;;) {
    const space = rest.match(/[\s\u3000]+$/)
    if (space) {
      trail = space[0] + trail
      rest = rest.slice(0, -space[0].length)
      continue
    }
    const mark = matchEdgeMarkAt(rest, true)
    if (mark) {
      trail = mark + trail
      rest = rest.slice(0, -mark.length)
      continue
    }
    const tok = matchTokenAt(rest, true)
    if (!tok) break
    trail = tok + trail
    rest = rest.slice(0, -tok.length)
  }

  return { lead, core: rest, trail }
}

/** 只匹配 RM 控制码（`\C[16]` / `\I[1]` / `C[16]`），不含 `…` 装饰 */
const CONTROL_AFFIX = /^(?:\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\])/

function matchControlAffixAt(text: string, atEnd: boolean): string | null {
  if (!atEnd) {
    const m = text.match(CONTROL_AFFIX)
    return m ? m[0] : null
  }
  /* 从末尾找最长控制码：扫全部 match 取贴尾的 */
  const re = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\\[[^\]]*\]|\\[^A-Za-z\s]|[A-Za-z_][A-Za-z0-9_]*\[\d+\]/g
  let hit: string | null = null
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i + m[0].length === text.length) hit = m[0]
  }
  return hit
}

/**
 * 只剥首尾 RM 控制码与紧邻空白（入库 / scrub 用）。
 * 与 {@link peelProtectShell} 不同：不剥 `…` / `♡` 等装饰，避免误改键。
 */
export function peelControlShell(text: string): { lead: string; core: string; trail: string } {
  let rest = String(text ?? '')
  let lead = ''
  let trail = ''

  for (;;) {
    const space = rest.match(/^[\s\u3000]+/)
    if (space) {
      lead += space[0]
      rest = rest.slice(space[0].length)
      continue
    }
    const tok = matchControlAffixAt(rest, false)
    if (!tok) break
    lead += tok
    rest = rest.slice(tok.length)
  }

  for (;;) {
    const space = rest.match(/[\s\u3000]+$/)
    if (space) {
      trail = space[0] + trail
      rest = rest.slice(0, -space[0].length)
      continue
    }
    const tok = matchControlAffixAt(rest, true)
    if (!tok) break
    trail = tok + trail
    rest = rest.slice(0, -tok.length)
  }

  return { lead, core: rest, trail }
}

/** 去掉控制码与占位后的纯文本，用于判定是否还要送翻。 */
export function stripControlNoise(text: string): string {
  return String(text ?? '')
    .replace(PROTECT_TOKEN, ' ')
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
}

/** 正文内剩余控制码 / `%n` / 装饰换成 ASCII 占位。 */
export function protectControlCodes(text: string): { plain: string; tokens: string[] } {
  const tokens: string[] = []
  const plain = String(text ?? '').replace(PROTECT_TOKEN, (m) => {
    const i = tokens.length
    tokens.push(m)
    return `__C${i}__`
  })
  return { plain, tokens }
}

/** 模型友好的 ASCII 占位，避免 Unicode 括号被吃掉 */
const PLACEHOLDER_RE = /__C(\d+)__/g
const PLACEHOLDER_FALLBACK_RE = /__Ｃ(\d+)__|＿＿C(\d+)＿＿|\[\[C(\d+)\]\]/g

/** 把占位符嵌回原文 token。 */
export function restoreControlCodes(translated: string, tokens: string[]): string {
  if (!tokens.length) return translated
  const pick = (n: string) => {
    const i = Number(n)
    return Number.isFinite(i) && tokens[i] != null ? tokens[i]! : null
  }
  let out = String(translated ?? '').replace(PLACEHOLDER_RE, (m, n) => pick(n) ?? m)
  out = out.replace(PLACEHOLDER_FALLBACK_RE, (m, a, b, c) => pick(a || b || c) ?? m)
  return out
}

export type ProtectForTranslate = {
  /** 剥掉首尾控制壳后的正文（可含文中 `%1` / `\C[n]`） */
  core: string
  lead: string
  trail: string
  plain: string
  tokens: string[]
}

/**
 * 送翻前：剥选项 if/en 壳 + 剥首尾控制壳 + 保护正文内 `%1` / 控制码 / 装饰符。
 * 例：`ミレリア学園if(s[3004])en(true)` → plain=`ミレリア学園` trail=`if(s[3004])en(true)`
 * 例：`_ABL\C[16]  次の%1まで` → lead=`_ABL\C[16]  ` plain=`次の__C0__まで`
 */
export function protectForTranslate(text: string): ProtectForTranslate {
  const choice = peelChoiceMetaTrail(text)
  const { lead, core, trail } = peelProtectShell(choice.core)
  const { plain, tokens } = protectControlCodes(core)
  return { core, lead, trail: trail + choice.trail, plain, tokens }
}

/** 局内即时替换用：把首尾控制壳嵌回译文。 */
export function restoreForTranslate(translated: string, ctx: ProtectForTranslate): string {
  return ctx.lead + restoreControlCodes(translated, ctx.tokens) + ctx.trail
}

/** 入库用：只要正文译文，不含首尾 `\C[n]` 等壳。 */
export function translationCoreForCache(translated: string, ctx: ProtectForTranslate): string {
  return restoreControlCodes(translated, ctx.tokens)
}

/** 原文与译文是否实质相同（NFKC + 空白归一）。 */
export function isIdenticalTranslation(src: string, zh: string): boolean {
  return normCmp(src) === normCmp(zh)
}

/** 严格入库：不保存原样结果，也不保存仍含日文假名的半成品；RM 控制码不参与判定。 */
export function isStorableTranslation(src: string, zh: string): boolean {
  if (!String(src ?? '').trim() || !String(zh ?? '').trim() || isIdenticalTranslation(src, zh)) return false
  const sourceText = normCmp(stripControlNoise(src))
  const translatedText = normCmp(stripControlNoise(zh))
  if (!translatedText || (sourceText && sourceText === translatedText)) return false
  if (JAPANESE.test(translatedText)) return false
  if (retainsJapaneseHanPhrase(sourceText, translatedText)) return false
  // 目标库只收中文；汉字原文（如日语汉字词）也不能被英文改写占位。
  return HAN.test(translatedText)
}

/**
 * 判定引擎输出是否可用：不能空、不能整句原样回吐；
 * 源文含日文时，译文需出现汉字。
 */
export function isUsefulTranslation(src: string, send: string, raw: string, zh: string): boolean {
  if (!String(raw ?? '').trim() || !String(zh ?? '').trim()) return false
  if (!isStorableTranslation(src, zh)) return false
  if (normCmp(raw) === normCmp(send)) return false
  const placeholders = send.match(/__C\d+__/g) || []
  if (placeholders.some((token) => !raw.includes(token))) return false
  const srcNeedsZh = JAPANESE.test(src) || HAN.test(stripControlNoise(src))
  if (srcNeedsZh && !HAN.test(zh)) return false
  return true
}

/** 是否需要送翻：剥壳与占位后仍含日文，且非纯标点。 */
export function shouldTranslate(text: string): boolean {
  const core = stripControlNoise(text)
  if (!core) return false
  if (!JAPANESE.test(core)) return false
  const compact = core.replace(/[\s\u3000]+/g, '')
  return !(compact.length > 0 && /^[\p{P}\p{S}]+$/u.test(compact))
}

/** Unicode 字符数（按码点）。 */
export function charCount(text: string): number {
  return Array.from(String(text ?? '')).length
}

/** 文本行数（至少 1；按换行拆分）。 */
export function lineCount(text: string): number {
  const src = String(text ?? '')
  if (!src) return 0
  return src.split(/\r\n|\n|\r/).length
}
