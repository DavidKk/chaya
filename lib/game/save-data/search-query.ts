/**
 * Numeric and quantity search matching utilities for save-data and game-edit workbench.
 */

export type NumericCondition = {
  op: '==' | '!=' | '>' | '>=' | '<' | '<='
  target: number
}

/**
 * Normalizes full-width symbols to half-width equivalents so users can search comfortably
 * in Chinese/Japanese IMEs (e.g. `数量：＞0` -> `数量:>0`).
 */
export function normalizeSearchSymbols(raw: string): string {
  return raw
    .replace(/：/g, ':')
    .replace(/＞＝/g, '>=')
    .replace(/＜＝/g, '<=')
    .replace(/！＝/g, '!=')
    .replace(/＜＞/g, '<>')
    .replace(/＞/g, '>')
    .replace(/＜/g, '<')
    .replace(/＝/g, '=')
    .replace(/！/g, '!')
    .replace(/＊/g, '*')
}

/**
 * Parses numeric search expressions:
 * - Comparison operators: `>0`, `>=10`, `<5`, `<=0`, `=5`, `==5`, `!=0`, `<>0`
 * - Prefixes: `qty:>5`, `count:5`, `num:10`, `val:0`, `数量:>=10`, `值:5`, `持有:>0`
 * - Multiplier / quantity notation: `x5`, `*5`
 */
export function parseNumericCondition(raw: string): NumericCondition | null {
  const s = normalizeSearchSymbols(raw).trim().toLowerCase()
  if (!s) return null

  // Prefix forms: qty:>5, count:5, 数量:>=10, val:5, 值:10, 持有:>0, qty=5, 数量=10
  const prefixMatch = s.match(/^(?:qty|count|num|val|数量|值|持有)[:=]?\s*([><=!]=?|<>)?\s*(-?\d+(?:\.\d+)?)$/)
  if (prefixMatch) {
    const rawOp = prefixMatch[1] || '=='
    const op = rawOp === '=' || rawOp === '==' ? '==' : rawOp === '<>' || rawOp === '!=' ? '!=' : (rawOp as NumericCondition['op'])
    const target = Number(prefixMatch[2])
    if (Number.isFinite(target)) return { op, target }
  }

  // Multiplier notation: x5, *5
  const multMatch = s.match(/^[x*]\s*(-?\d+(?:\.\d+)?)$/)
  if (multMatch) {
    const target = Number(multMatch[1])
    if (Number.isFinite(target)) return { op: '==', target }
  }

  // Operator forms: >0, >=10, <5, <=0, =5, ==5, !=0, <>0
  const opMatch = s.match(/^([><=!]=?|<>)\s*(-?\d+(?:\.\d+)?)$/)
  if (opMatch) {
    const rawOp = opMatch[1]
    const op = rawOp === '=' || rawOp === '==' ? '==' : rawOp === '<>' || rawOp === '!=' ? '!=' : (rawOp as NumericCondition['op'])
    const target = Number(opMatch[2])
    if (Number.isFinite(target)) return { op, target }
  }

  return null
}

export function evalNumericCondition(value: number, cond: NumericCondition): boolean {
  switch (cond.op) {
    case '==':
      return value === cond.target
    case '!=':
      return value !== cond.target
    case '>':
      return value > cond.target
    case '>=':
      return value >= cond.target
    case '<':
      return value < cond.target
    case '<=':
      return value <= cond.target
    default:
      return false
  }
}

export type RowQueryTarget = {
  id: number
  name: string
  description?: string | null
  value?: number | boolean | string | null
}

/**
 * Matches a row against user query tokens.
 * Supports:
 * - Text matching against name, description, and ID.
 * - Number matching against item quantity or variable value.
 * - Comparison operators: `>0`, `>=10`, `<5`, `<=0`, `=5`, `!=0`.
 * - Prefix and multiplier syntax: `qty:5`, `count:>0`, `数量:>=10`, `x5`.
 * - Boolean matching for switches: `on`, `off`, `true`, `false`, `开`, `关`.
 * - Multi-token combined search (space-separated, AND condition): e.g. `草药 >0`, `药水 5`, `金币 >1000`.
 */
export function matchRowQuery(row: RowQueryTarget, q: string): boolean {
  const trimmed = normalizeSearchSymbols(q).trim()
  if (!trimmed) return true

  // Normalize spaces around operators or prefixes so e.g. "> 0" -> ">0", "qty: 5" -> "qty:5", "数量: > 0" -> "数量:>0"
  // Also split comparison operators attached to words: e.g. "草药>0" -> "草药 >0"
  const normalized = trimmed
    .replace(/(?<=[^\s><=!:])([><=!]=?|<>)\s*(-?\d+)/g, ' $1$2')
    .replace(/(?:^|\s)(qty|count|num|val|数量|值|持有)[:=]?\s+([><=!]=?|<>)?\s*(-?\d+)/gi, ' $1:$2$3')
    .replace(/(?:^|\s)([><=!]=?|<>)\s+(-?\d+)/g, ' $1$2')
    .replace(/([\u4e00-\u9fa5])([x*])\s*(-?\d+)/g, '$1 $2$3')
    .trim()

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true

  const stringVal = typeof row.value === 'string' ? row.value : null
  const textBlob = `${row.name || ''} ${row.description || ''} ${row.id} ${stringVal || ''}`.toLowerCase()
  const numVal =
    typeof row.value === 'number' && Number.isFinite(row.value)
      ? row.value
      : stringVal != null && Number.isFinite(Number(stringVal)) && stringVal.trim() !== ''
        ? Number(stringVal)
        : null
  const boolVal = typeof row.value === 'boolean' ? row.value : null

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase()

    // 1. Check for explicit numeric condition (>0, >=10, qty:5, x5, etc.)
    const cond = parseNumericCondition(token)
    if (cond) {
      if (numVal != null) {
        if (!evalNumericCondition(numVal, cond)) return false
        continue
      }
      return false
    }

    // 2. Check for boolean switch matching if row is a switch
    if (boolVal != null) {
      if (token === 'on' || token === 'true' || token === '开' || token === '开启') {
        if (!boolVal) return false
        continue
      }
      if (token === 'off' || token === 'false' || token === '关' || token === '关闭') {
        if (boolVal) return false
        continue
      }
    }

    // 3. Plain token: could match text (name/desc/id) OR exact numeric value
    const textMatches = textBlob.includes(token)
    const exactNum = Number(token)
    const numMatches = Number.isFinite(exactNum) && numVal != null && numVal === exactNum

    if (!textMatches && !numMatches) {
      return false
    }
  }

  return true
}
