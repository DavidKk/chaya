'use client'

import { type KeyboardEvent, useSyncExternalStore } from 'react'
import { IoAlertCircleOutline, IoArrowUndoOutline, IoCheckmark, IoReturnDownBackOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Select, TextInput } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { allowedTypes, type DataCell, type DataPath, defaultType, draftText, type ExpectType, parseDraft, type ValueType } from '@/lib/game/save-data'
import { cn } from '@/lib/utils'

import { lockIconBtn } from '../lock-ui'
import { type Draft, draftStore } from './store'

type Props = {
  rowKey: string
  path: DataPath
  ownerOid: number
  cell: DataCell | undefined
  expectType?: ExpectType
  nullable: boolean
  label?: string
  confirm?: boolean
  disabled?: boolean
  onApply: (key: string) => void
  onReadFull: (path: DataPath) => Promise<DataCell | null>
}

const TYPE_LABEL = { number: 'data.typeNumber', string: 'data.typeString', boolean: 'data.typeBoolean', null: 'data.typeNull' } as const

const boolBtn = cn(
  'h-7 cursor-pointer rounded-[0.2rem] border border-line bg-transparent px-2 font-mono text-[0.75rem] text-ink-soft transition-colors',
  'hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-45'
)
const boolBtnOn = 'border-accent bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-ink'

/** The "change to" control: edits a draft only; live value updates never touch it */
export function DraftInput({ rowKey, path, ownerOid, cell, expectType, nullable, label, confirm, disabled, onApply, onReadFull }: Props) {
  const t = useT()
  const draft = useSyncExternalStore(
    (cb) => draftStore.subscribeKey(rowKey, cb),
    () => draftStore.get(rowKey),
    () => undefined
  )
  const kind = cell?.kind ?? 'undefined'
  const types = allowedTypes(kind, expectType, nullable)
  const type: ValueType = draft?.type ?? defaultType({ kind }, expectType)
  if (!types.length) return null

  const write = (patch: Partial<Draft> & { raw: string; type: ValueType }) => {
    const base: Draft = draft && draft.state !== 'stale' ? draft : { path, ownerOid, label, confirm, type, raw: '', state: 'pending' }
    draftStore.set(rowKey, { ...base, ...patch, ownerOid: base.ownerOid, state: 'pending', error: undefined })
  }

  const fill = async () => {
    if (!cell) return
    if (cell.kind === 'string' && cell.truncated) {
      const full = await onReadFull(path)
      if (full?.kind === 'string') write({ raw: String(full.value ?? ''), type: 'string' })
      return
    }
    const nextType: ValueType = cell.kind === 'number' || cell.kind === 'string' || cell.kind === 'boolean' ? cell.kind : type
    write({ raw: draftText(cell.value), type: nextType })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && draft) {
      e.preventDefault()
      onApply(rowKey)
    } else if (e.key === 'Escape' && draft) {
      e.preventDefault()
      e.stopPropagation()
      draftStore.delete(rowKey)
    }
  }

  const stale = draft?.state === 'stale'
  const invalid = draft?.state === 'error' || (!!draft && type === 'number' && !parseDraft(draft.raw, 'number').ok)
  const tip = stale ? t('data.stale') : draft?.state === 'error' ? draft.error : undefined

  const showTypes = types.filter((v) => v !== 'null').length > 1 || type === 'null' || kind === 'null' || kind === 'undefined'
  const typeSelect =
    showTypes && types.length > 1 ? (
      <Select
        value={type}
        options={types.map((v) => ({ value: v, label: t(TYPE_LABEL[v]) }))}
        onChange={(v) => {
          const next = v as ValueType
          write({ raw: next === 'boolean' ? 'true' : next === type ? (draft?.raw ?? '') : '', type: next })
        }}
        disabled={disabled}
        aria-label={t('data.typeAria')}
        className="w-[5.5rem] shrink-0"
      />
    ) : null

  let control
  if (type === 'boolean') {
    control = (
      <span className="inline-flex items-center gap-1">
        {(['true', 'false'] as const).map((v) => (
          <button key={v} type="button" disabled={disabled} className={cn(boolBtn, draft?.raw === v && !stale && boolBtnOn)} onClick={() => write({ raw: v, type })}>
            {v}
          </button>
        ))}
      </span>
    )
  } else if (type === 'null') {
    control = (
      <button type="button" disabled={disabled} className={cn(boolBtn, draft && !stale && boolBtnOn)} onClick={() => write({ raw: '', type })}>
        null
      </button>
    )
  } else {
    control = (
      <TextInput
        value={stale ? '' : (draft?.raw ?? '')}
        placeholder={stale ? t('data.stale') : t('data.draftPh')}
        inputMode={type === 'number' ? 'decimal' : undefined}
        disabled={disabled}
        invalid={invalid || stale}
        fullWidth
        className={cn('h-7 min-w-0', type === 'number' && 'font-mono')}
        aria-label={t('data.colTarget')}
        onChange={(e) => {
          const raw = e.target.value
          if (!raw && type !== 'string') draftStore.delete(rowKey)
          else write({ raw, type })
        }}
        onFocus={() => {
          if (!draft && cell?.kind === 'string' && cell.truncated) void fill()
        }}
        onKeyDown={onKeyDown}
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {typeSelect}
      <span className="flex min-w-0 flex-1">{control}</span>
      {tip ? (
        <Tooltip content={tip}>
          <span className="inline-flex shrink-0 text-fail" role="img" aria-label={tip}>
            <IoAlertCircleOutline size={15} aria-hidden />
          </span>
        </Tooltip>
      ) : null}
      <Tooltip content={t('data.fill')}>
        <button type="button" className={lockIconBtn} disabled={disabled} aria-label={t('data.fill')} onClick={() => void fill()}>
          <IoReturnDownBackOutline size={14} aria-hidden />
        </button>
      </Tooltip>
      {draft ? (
        <>
          <Tooltip content={t('data.applyRow')}>
            <button type="button" className={cn(lockIconBtn, 'text-accent')} disabled={disabled || stale} aria-label={t('data.applyRow')} onClick={() => onApply(rowKey)}>
              <IoCheckmark size={15} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip content={t('data.discardRow')}>
            <button type="button" className={lockIconBtn} aria-label={t('data.discardRow')} onClick={() => draftStore.delete(rowKey)}>
              <IoArrowUndoOutline size={14} aria-hidden />
            </button>
          </Tooltip>
        </>
      ) : null}
    </div>
  )
}
