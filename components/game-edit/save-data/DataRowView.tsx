'use client'

import { Menu } from '@base-ui/react/menu'
import { memo, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IoChevronForward, IoEllipsisHorizontal, IoLockClosed, IoLockOpenOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { dropdownItemClass, dropdownPopupClass } from '@/components/sk/dropdownMenu'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { type DataCell, type DataPath, type DataRow, isContainerKind } from '@/lib/game/save-data'
import { cn } from '@/lib/utils'

import { lockIconBtn } from '../lock-ui'
import { DraftInput } from './DraftInput'
import { cellText, rowName } from './labels'
import { valueStore, writtenStore } from './store'

export type RowMenuItem = { id: string; label: string; danger?: boolean; onSelect: () => void }

type Props = {
  row: DataRow
  rowKey: string
  path: DataPath
  ownerOid: number
  narrow: boolean
  locked: boolean
  canEdit: boolean
  /** Secondary line under the name (search hits: where the field lives) */
  where?: string
  onOpen: (path: DataPath) => void
  onApply: (key: string) => void
  onLock: (path: DataPath, ownerOid: number, on: boolean, label?: string) => void
  onReadFull: (path: DataPath) => Promise<DataCell | null>
  menu: (path: DataPath, row: DataRow, ownerOid: number) => RowMenuItem[]
}

function useCell(key: string) {
  return useSyncExternalStore(
    (cb) => valueStore.subscribeKey(key, cb),
    () => valueStore.get(key),
    () => undefined
  )
}

function CurrentValue({ rowKey, fallback }: { rowKey: string; fallback: DataCell }) {
  const t = useT()
  const entry = useCell(rowKey)
  const ref = useRef<HTMLSpanElement>(null)
  const cell = entry?.cell ?? fallback
  const changedAt = entry?.changedAt ?? 0
  useEffect(() => {
    if (!changedAt || !ref.current?.animate) return
    ref.current.animate([{ backgroundColor: 'color-mix(in oklab, var(--accent) 28%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 600, easing: 'ease-out' })
  }, [changedAt])
  const text = cellText(t, cell)
  return (
    <span ref={ref} className={cn('block min-w-0 truncate rounded-[0.2rem] px-1 font-mono text-[0.75rem]', isContainerKind(cell.kind) ? 'text-ink-soft' : 'text-ink')} title={text}>
      {text}
    </span>
  )
}

function RowMenu({ getItems, label }: { getItems: () => RowMenuItem[]; label: string }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<ShadowRoot>()
  const [items, setItems] = useState<RowMenuItem[]>([])
  return (
    <span ref={anchorRef} className="inline-flex">
      <Menu.Root
        onOpenChange={(open) => {
          if (!open) return
          setItems(getItems())
          const root = anchorRef.current?.getRootNode()
          if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
        }}
      >
        <Menu.Trigger className={lockIconBtn} aria-label={label}>
          <IoEllipsisHorizontal size={15} aria-hidden />
        </Menu.Trigger>
        <Menu.Portal container={container}>
          <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={8} positionMethod="fixed" className="z-[70]">
            <Menu.Popup aria-label={label} className={dropdownPopupClass}>
              {items.map((item) => (
                <Menu.Item key={item.id} className={cn(dropdownItemClass, item.danger && 'text-fail')} onClick={item.onSelect}>
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  )
}

/** One field: name · current value (live) · change-to (draft) · actions */
export const DataRowView = memo(function DataRowView({ row, rowKey, path, ownerOid, narrow, locked, canEdit, where, onOpen, onApply, onLock, onReadFull, menu }: Props) {
  const t = useT()
  const written = useSyncExternalStore(
    (cb) => writtenStore.subscribeKey(rowKey, cb),
    () => writtenStore.has(rowKey),
    () => false
  )
  const live = useCell(rowKey)?.cell ?? row
  const name = rowName(t, row)
  const container = isContainerKind(live.kind)
  const primitive = !container && live.kind !== 'cycle' && live.kind !== 'unsupported'
  const editable = canEdit && primitive && !row.readonly
  const lockable = editable && live.kind !== 'null' && live.kind !== 'undefined' && !row.presetLock

  const nameCell = (
    <div className="flex min-w-0 items-center gap-1.5">
      {written ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title={t('data.written')} aria-label={t('data.written')} /> : null}
      <div className="min-w-0">
        {container ? (
          <button
            type="button"
            className="block max-w-full cursor-pointer truncate border-none bg-transparent p-0 text-left text-[0.8125rem] font-medium text-ink hover:text-accent"
            onClick={() => onOpen(path)}
            title={name}
          >
            {name}
          </button>
        ) : (
          <div className="truncate text-[0.8125rem] font-medium text-ink" title={name}>
            {name}
          </div>
        )}
        {where || name !== row.key ? (
          <div className="truncate font-mono text-[0.68rem] text-ink-soft" title={where || row.key}>
            {where || row.key}
          </div>
        ) : null}
      </div>
      {row.readonly ? (
        <Tooltip content={t('data.readonlyTip')}>
          <span className="shrink-0 rounded-[0.2rem] border border-line px-1 text-[0.62rem] text-ink-soft">{t('data.readonly')}</span>
        </Tooltip>
      ) : row.confirm ? (
        <Tooltip content={t('data.confirmTip')}>
          <span className="shrink-0 rounded-[0.2rem] border border-warn px-1 text-[0.62rem] text-warn">{t('data.confirmBadge')}</span>
        </Tooltip>
      ) : null}
    </div>
  )

  let target: ReactNode = null
  if (container) {
    target = (
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-0.5 border-none bg-transparent p-0 text-[0.75rem] text-ink-soft hover:text-accent"
        onClick={() => onOpen(path)}
        aria-label={t('data.open', { name })}
      >
        {t('data.items', { count: live.size ?? 0 })}
        <IoChevronForward size={13} aria-hidden />
      </button>
    )
  } else if (editable) {
    target = (
      <DraftInput
        rowKey={rowKey}
        path={path}
        ownerOid={ownerOid}
        cell={live}
        expectType={row.expectType}
        nullable={row.nullable !== false}
        label={name}
        confirm={row.confirm}
        onApply={onApply}
        onReadFull={onReadFull}
      />
    )
  }

  const lockTip = row.presetLock ? t('data.lockPreset', { lock: row.presetLock }) : locked ? t('data.lockOff', { name }) : t('data.lockOn', { name })
  const actions = (
    <div className="flex shrink-0 items-center justify-end gap-0.5">
      {lockable || locked || row.presetLock ? (
        <Tooltip content={lockTip}>
          <button
            type="button"
            className={cn(lockIconBtn, (locked || row.presetLock) && 'text-accent')}
            disabled={!!row.presetLock || (!lockable && !locked)}
            aria-label={lockTip}
            aria-pressed={locked}
            onClick={() => onLock(path, ownerOid, !locked, name)}
          >
            {locked || row.presetLock ? <IoLockClosed size={14} aria-hidden /> : <IoLockOpenOutline size={14} aria-hidden />}
          </button>
        </Tooltip>
      ) : null}
      <RowMenu getItems={() => menu(path, row, ownerOid)} label={t('data.more')} />
    </div>
  )

  if (narrow) {
    return (
      <div className="flex h-full flex-col justify-center gap-1 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">{nameCell}</div>
          <div className="max-w-[45%] min-w-0">
            <CurrentValue rowKey={rowKey} fallback={row} />
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <div className="flex min-w-0 flex-1">{target}</div>
          {actions}
        </div>
      </div>
    )
  }

  return (
    <div className={cn('grid h-full items-center gap-3 border-b border-line px-3 hover:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]', DATA_COLS)}>
      {nameCell}
      <CurrentValue rowKey={rowKey} fallback={row} />
      <div className="flex min-w-0">{target}</div>
      {actions}
    </div>
  )
})

export const DATA_COLS = 'grid-cols-[minmax(9rem,1.1fr)_minmax(6rem,1fr)_minmax(13rem,1.4fr)_3.5rem]'
export const ROW_HEIGHT = 40
export const ROW_HEIGHT_NARROW = 64
