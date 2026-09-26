/**
 * 纯查表增强（无 I/O）：整句 / 规范化 / 按行 / RM 控制码切段 / 末尾数字族。
 * 局内 ChayaTrans 与 Node `game-lookup` 共用。
 */

import { hasRmDigitCodes, lookupWithRmDigitTemplate, RM_ESCAPE_RE } from '@/lib/translate/rm-escape'

export type TranslateExtraGet = (src: string) => string | null | undefined

export { applyRmDigitCodes, extractRmDigitCodes, hasRmDigitCodes, toRmDigitTemplate } from '@/lib/translate/rm-escape'

/** 与局内 ChayaTrans 一致：剥脏引号 / 脚本残片；再做 NFKC，提高全半角命中。 */
export function normalizeTranslateKey(text: string): string {
  let s = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
  s = s.replace(/^"+/, '').replace(/("\);|"\))$/, '')
  try {
    s = s.normalize('NFKC')
  } catch {
    /* 极旧环境无 normalize */
  }
  return s
}

/**
 * 末尾数字族：自警団の団員2 / 3 / 4…
 * 排除明显句尾，避免把完整句子误当成「词干+编号」。
 */
export function trailingNumberParts(text: string): { stem: string; num: string } | null {
  const m = String(text || '').match(/^(.*[^\d０-９])([0-9０-９]+)$/)
  if (!m) return null
  const stem = m[1]
  const num = m[2]
  if (!stem || stem.length < 2) return null
  if (!/[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF65-\uFF9F]/.test(stem)) return null
  if (/[ただですますねよ]$/u.test(stem)) return null
  if (/[。！？!?]$/.test(stem)) return null
  return { stem, num }
}

export function stripTrailingNumber(text: string): string {
  return String(text ?? '').replace(/[0-9０-９]+$/, '')
}

export function swapTrailingNumber(translated: string, fromNum: string | null | undefined, toNum: string): string {
  if (!toNum) return translated
  if (!fromNum) return /[0-9０-９]+$/.test(translated) ? translated : translated + toNum
  if (/[0-9０-９]+$/.test(translated)) return translated.replace(/[0-9０-９]+$/, toNum)
  return translated + toNum
}

function lookupExact(lookup: Record<string, string>, extraGet: TranslateExtraGet | undefined, src: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(lookup, src)) return lookup[src]
  const hit = extraGet?.(src)
  return hit == null || hit === '' ? undefined : hit
}

function lookupPlainOrRmTemplate(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string | undefined {
  const direct = lookupExact(lookup, extraGet, text)
  if (direct != null) return direct
  if (!hasRmDigitCodes(text)) return undefined
  const hit = lookupWithRmDigitTemplate((key) => lookupExact(lookup, extraGet, key) ?? null, text)
  return hit == null ? undefined : hit
}

/** 整句 / 规范化 / 去首尾空白 查表（含 `\n[1]`↔`\n[3]` 数字码模板）。 */
export function translatePlain(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string {
  if (!text) return text
  const direct = lookupPlainOrRmTemplate(lookup, text, extraGet)
  if (direct != null) return direct
  const norm = normalizeTranslateKey(text)
  if (norm !== text) {
    const nHit = lookupPlainOrRmTemplate(lookup, norm, extraGet)
    if (nHit != null) return nHit
  }
  const lead = text.match(/^\s*/)?.[0] ?? ''
  const trail = text.match(/\s*$/)?.[0] ?? ''
  const core = text.slice(lead.length, text.length - trail.length)
  if (core && core !== text) {
    const cHit = lookupPlainOrRmTemplate(lookup, core, extraGet)
    if (cHit != null) return `${lead}${cHit}${trail}`
    const cNorm = normalizeTranslateKey(core)
    if (cNorm !== core) {
      const cnHit = lookupPlainOrRmTemplate(lookup, cNorm, extraGet)
      if (cnHit != null) return `${lead}${cnHit}${trail}`
    }
  }
  return text
}

/**
 * RPG Maker 描述常含 `\C[n]` / `\FS[n]` / `\I[n]` 等控制码。
 * 缓存几乎只存纯文本片段，整串精确匹配会大量 miss；按控制码切段再拼回。
 */
export function translateRmSegments(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string {
  if (!RM_ESCAPE_RE.test(text)) return text
  RM_ESCAPE_RE.lastIndex = 0
  let any = false
  let out = ''
  let last = 0
  for (const m of text.matchAll(RM_ESCAPE_RE)) {
    const idx = m.index ?? 0
    if (idx > last) {
      const seg = text.slice(last, idx)
      const zh = translatePlain(lookup, seg, extraGet)
      if (zh !== seg) any = true
      out += zh
    }
    out += m[0]
    last = idx + m[0].length
  }
  if (last < text.length) {
    const seg = text.slice(last)
    const zh = translatePlain(lookup, seg, extraGet)
    if (zh !== seg) any = true
    out += zh
  }
  return any ? out : text
}

function translateByLines(lookup: Record<string, string>, text: string, extraGet?: TranslateExtraGet): string {
  if (!text.includes('\n')) return text
  let any = false
  const out = text.split('\n').map((line) => {
    const zh = translatePlain(lookup, line, extraGet)
    if (zh !== line) any = true
    return zh
  })
  return any ? out.join('\n') : text
}

/**
 * 用已见过的「词干→去数字译文」推导末尾编号变体。
 * stemBase 由调用方在写入缓存时维护（见 indexTrailingStem）。
 */
export function translateTrailingNumber(text: string, stemBase: ReadonlyMap<string, string>, lookup: Record<string, string>, extraGet?: TranslateExtraGet): string | null {
  const parts = trailingNumberParts(text)
  if (!parts) return null
  const base = stemBase.get(parts.stem)
  if (base != null && base !== '') {
    return swapTrailingNumber(base, null, parts.num)
  }
  // 词干本身在表里（少见）
  const stemZh = translatePlain(lookup, parts.stem, extraGet)
  if (stemZh !== parts.stem) return swapTrailingNumber(stemZh, null, parts.num)
  return null
}

/** 写入缓存时登记末尾数字族词干，供后续编号变体 O(1) 推导。 */
export function indexTrailingStem(stemBase: Map<string, string>, src: string, zh: string) {
  const parts = trailingNumberParts(src)
  if (!parts) return
  const base = stripTrailingNumber(zh)
  if (!base) return
  // 先写入的样本保留；同词干后写覆盖（与 NDJSON 后写覆盖一致）
  stemBase.set(parts.stem, base)
}

export type TranslateWithLookupOptions = {
  extraGet?: TranslateExtraGet
  /** 末尾数字族词干表；不传则只做精确/行/控制码 */
  stemBase?: ReadonlyMap<string, string>
}

/** 查表翻译；无命中则原样返回。 */
export function translateWithLookup(lookup: Record<string, string>, text: string, opts?: TranslateWithLookupOptions): string {
  if (!text) return text
  const extraGet = opts?.extraGet
  const plain = translatePlain(lookup, text, extraGet)
  if (plain !== text) return plain
  if (opts?.stemBase) {
    const derived = translateTrailingNumber(text, opts.stemBase, lookup, extraGet)
    if (derived != null) return derived
  }
  const byLine = translateByLines(lookup, text, extraGet)
  if (byLine !== text) return byLine
  return translateRmSegments(lookup, text, extraGet)
}
