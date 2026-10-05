import type { DataCell, DataKind, ExpectType, PrimitiveValue, ValueType } from './types'

export function kindOfPrimitive(value: unknown): DataKind | null {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  return null
}

export function isPrimitiveKind(kind: DataKind): boolean {
  return kind === 'number' || kind === 'string' || kind === 'boolean' || kind === 'null' || kind === 'undefined'
}

export function isContainerKind(kind: DataKind): boolean {
  return kind === 'object' || kind === 'array'
}

/** Types an empty (null / undefined) field may take */
export function typesForEmpty(expect: ExpectType | undefined, nullable: boolean): ValueType[] {
  if (expect === 'number|string') return ['number', 'string']
  if (expect) return [expect]
  return nullable ? ['number', 'string', 'boolean', 'null'] : ['number', 'string', 'boolean']
}

/** Types a field accepts: a field with a value keeps its type (variables may switch number ↔ string) */
export function allowedTypes(kind: DataKind, expect: ExpectType | undefined, nullable: boolean): ValueType[] {
  if (kind === 'null' || kind === 'undefined') return typesForEmpty(expect, nullable)
  if (kind !== 'number' && kind !== 'string' && kind !== 'boolean') return []
  const base: ValueType[] = expect === 'number|string' && kind !== 'boolean' ? ['number', 'string'] : [kind]
  return nullable ? [...base, 'null'] : base
}

/** Default draft type for a cell: keep the current primitive type, otherwise the expected type */
export function defaultType(cell: Pick<DataCell, 'kind'>, expect?: ExpectType): ValueType {
  if (cell.kind === 'number' || cell.kind === 'string' || cell.kind === 'boolean') return cell.kind
  if (expect === 'number|string') return 'number'
  return expect ?? 'number'
}

export type ParseResult = { ok: true; value: PrimitiveValue } | { ok: false; reason: 'empty' | 'number' }

/** Draft text → value of the given type; numbers must be finite */
export function parseDraft(raw: string, type: ValueType): ParseResult {
  if (type === 'null') return { ok: true, value: null }
  if (type === 'boolean') return { ok: true, value: raw === 'true' }
  if (type === 'string') return { ok: true, value: raw }
  const text = raw.trim()
  if (!text) return { ok: false, reason: 'empty' }
  const n = Number(text)
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: 'number' }
}

/** Value → draft text (for "fill current value") */
export function draftText(value: PrimitiveValue | undefined): string {
  if (value == null) return ''
  return String(value)
}

export function matchesType(value: unknown, type: ValueType): boolean {
  if (type === 'null') return value === null
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

/** Short display text for a primitive cell; containers are labelled by the caller */
export function primitiveText(cell: Pick<DataCell, 'kind' | 'value' | 'truncated'>): string {
  if (cell.kind === 'null') return 'null'
  if (cell.kind === 'undefined') return '—'
  if (cell.kind === 'string') return `"${String(cell.value ?? '')}${cell.truncated ? '…' : ''}"`
  return String(cell.value)
}

export function samePrimitive(a: unknown, b: unknown): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b))
}

/** Whether two cells describe the same value (containers by identity and shape) */
export function sameCell(a: DataCell | undefined, b: DataCell | undefined): boolean {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (isContainerKind(a.kind)) return a.oid === b.oid && a.size === b.size && a.sig === b.sig
  return samePrimitive(a.value, b.value) && !!a.truncated === !!b.truncated
}
