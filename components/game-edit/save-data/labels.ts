import type { useT } from '@/components/i18n/LocaleProvider'
import { type DataCell, type DataErrorCode, type DataUndoSummary, primitiveText } from '@/lib/game/save-data'
import type { MessageKey } from '@/lib/i18n'

export type T = ReturnType<typeof useT>

const ERR_KEY: Record<DataErrorCode, MessageKey> = {
  stale: 'data.err.stale',
  readonly: 'data.err.readonly',
  confirm: 'data.err.confirm',
  type: 'data.err.type',
  missing: 'data.err.missing',
  'not-ready': 'data.err.notReady',
  invalid: 'data.err.invalid',
  'preset-lock': 'data.err.presetLock',
  unsupported: 'data.err.unsupported',
}

export function errorText(t: T, code: DataErrorCode | undefined, fallback?: string): string {
  return code ? t(ERR_KEY[code]) : fallback || t('data.err.invalid')
}

/** Display name of a row: game label, UI label, or the raw key */
export function rowName(t: T, row: { key: string; label?: string; labelKey?: string }): string {
  if (row.label) return row.label
  if (row.labelKey) {
    const text = t(row.labelKey as MessageKey)
    if (text !== row.labelKey) return text
  }
  return row.key
}

/** Name for a path segment (breadcrumb / hits); root keys use UI labels */
export function segmentName(t: T, key: string, label: string | null | undefined, depth: number): string {
  if (label) return label
  if (depth === 0) {
    const k = `data.root.${key}` as MessageKey
    const text = t(k)
    if (text !== k) return text
  }
  return key
}

export function cellText(t: T, cell: DataCell | undefined): string {
  if (!cell) return ''
  switch (cell.kind) {
    case 'object':
    case 'array':
      return `${cell.className || (cell.kind === 'array' ? 'Array' : 'Object')} · ${t('data.items', { count: cell.size ?? 0 })}`
    case 'cycle':
      return `↻ ${t('data.cycle')}`
    case 'unsupported':
      return `${cell.className || ''} ${t('data.unsupported')}`.trim()
    default:
      return primitiveText(cell)
  }
}

const KIND_TONE: Partial<Record<DataCell['kind'], string>> = {
  number: 'text-accent',
  string: 'text-ok',
  boolean: 'text-[color-mix(in_oklab,var(--accent)_35%,var(--fail))]',
  null: 'text-ink-soft italic',
  undefined: 'text-ink-soft italic',
  object: 'text-warn',
  array: 'text-[color-mix(in_oklab,var(--warn)_50%,var(--fail))]',
}

/** Text color by value type so numbers, strings, booleans and containers read apart */
export function cellTone(cell: DataCell | undefined): string {
  return (cell && KIND_TONE[cell.kind]) || 'text-ink-soft'
}

export function undoText(t: T, summary: DataUndoSummary | null): string {
  const first = summary?.first
  if (!summary || !first) return t('data.undoEmpty')
  const name = first.label || first.path[first.path.length - 1] || ''
  if (summary.kind === 'struct') {
    if (first.before.kind === 'undefined') return t('data.undoAdded', { name })
    if (first.after.kind === 'undefined') return t('data.undoRemoved', { name })
  }
  const params = { name, before: cellText(t, first.before), after: cellText(t, first.after), count: summary.count - 1 }
  return summary.count > 1 ? t('data.undoLineMore', params) : t('data.undoLine', params)
}
