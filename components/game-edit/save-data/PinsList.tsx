'use client'

import { type ReactNode, useState } from 'react'
import { IoChevronForward, IoStar } from 'react-icons/io5'
import { MdDragIndicator } from 'react-icons/md'

import { useT } from '@/components/i18n/LocaleProvider'
import { EmptyState, ScrollArea, TextAction } from '@/components/sk'
import { type DataPath, type DataRowAt, pathExpression, pathKey } from '@/lib/game/save-data'
import { cn } from '@/lib/utils'

import { DataListHeader, type RowHandlers } from './DataList'
import { DATA_COLS, DataRowView, ROW_HEIGHT, ROW_HEIGHT_NARROW } from './DataRowView'
import { segmentName } from './labels'
import type { PinRow } from './useSaveData'

/** Parent path of a pinned / found field; each segment opens that level */
export function WherePath({ row, onOpen }: { row: Pick<DataRowAt, 'path' | 'labels'>; onOpen: (path: DataPath) => void }) {
  const t = useT()
  const parents = row.path.slice(0, -1)
  return (
    <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
      {parents.map((seg, i) => {
        const label = segmentName(t, seg, row.labels[i], i)
        return (
          <span key={i} className="flex min-w-0 items-center gap-0.5">
            {i ? <span aria-hidden>›</span> : null}
            <button
              type="button"
              className="max-w-[8rem] cursor-pointer truncate border-none bg-transparent p-0 font-mono text-[0.68rem] text-ink-soft hover:text-accent"
              title={t('data.open', { name: label })}
              onClick={() => onOpen(row.path.slice(0, i + 1))}
            >
              {label}
            </button>
          </span>
        )
      })}
    </span>
  )
}

/** Root-level row that opens the 常用 virtual level */
export function PinsEntry({ count, narrow, onOpen }: { count: number; narrow: boolean; onOpen: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      className={cn(
        'h-full w-full cursor-pointer items-center gap-3 border-0 border-b border-line bg-transparent px-3 text-left hover:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]',
        narrow ? 'flex' : cn('grid', DATA_COLS)
      )}
      onClick={onOpen}
      aria-label={t('data.open', { name: t('data.pinsTitle') })}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] font-medium text-ink">
        <IoStar size={13} className="shrink-0 text-warn" aria-hidden />
        {t('data.pinsTitle')}
      </span>
      <span className="px-1 font-mono text-[0.75rem] text-ink-soft">{t('data.pinsHint')}</span>
      <span className="inline-flex items-center gap-0.5 text-[0.75rem] text-warn">
        {t('data.items', { count })}
        <IoChevronForward size={13} aria-hidden />
      </span>
    </button>
  )
}

type Props = RowHandlers & {
  rows: PinRow[]
  userPins: Set<string>
  narrow: boolean
  lockedKeys: Set<string>
  canEdit: boolean
  onUnpin: (path: DataPath) => void
  onReorder: (from: DataPath, to: DataPath) => void
}

/** 常用 level: preset + user pins as regular rows; user pins can be dragged to reorder */
export function PinsList({ rows, userPins, narrow, lockedKeys, canEdit, onUnpin, onReorder, ...handlers }: Props) {
  const t = useT()
  const [dragging, setDragging] = useState<DataPath | null>(null)
  const [over, setOver] = useState<string | null>(null)
  if (!rows.length) return <EmptyState title={t('data.pinsEmpty')} message={t('data.pinsEmptyMsg')} />
  const height = narrow ? ROW_HEIGHT_NARROW : ROW_HEIGHT

  const wrap = (row: PinRow, key: string, content: ReactNode) => {
    const movable = userPins.has(key)
    return (
      <div
        key={key}
        role="listitem"
        className={cn('relative flex', over === key && dragging && 'shadow-[inset_0_2px_0_var(--accent)]')}
        style={{ height }}
        onDragOver={(e) => {
          if (!dragging || !movable) return
          e.preventDefault()
          setOver(key)
        }}
        onDragLeave={() => setOver((cur) => (cur === key ? null : cur))}
        onDrop={(e) => {
          e.preventDefault()
          if (dragging && movable) onReorder(dragging, row.path)
          setDragging(null)
          setOver(null)
        }}
      >
        <span
          className={cn('flex w-4 shrink-0 items-center justify-center text-ink-soft', movable ? 'cursor-grab' : 'invisible')}
          draggable={movable}
          aria-label={movable ? t('data.pinDrag') : undefined}
          title={movable ? t('data.pinDrag') : undefined}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', key)
            setDragging(row.path)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOver(null)
          }}
        >
          <MdDragIndicator size={14} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">{content}</div>
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('data.pinsTitle') }}>
      <div className="sticky top-0 z-[2]">
        <DataListHeader narrow={narrow} className="pl-7" />
      </div>
      <div role="list">
        {rows.map((row) => {
          const key = pathKey(row.path)
          if ('missing' in row) {
            return wrap(
              row,
              key,
              <div className="flex h-full items-center gap-2 border-b border-line px-3 text-xs text-ink-soft">
                <span className="min-w-0 flex-1 truncate font-mono">{pathExpression(row.path)}</span>
                <span>{t('data.pinUnavailable')}</span>
                {userPins.has(key) ? <TextAction onClick={() => onUnpin(row.path)}>{t('data.unpin')}</TextAction> : null}
              </div>
            )
          }
          return wrap(
            row,
            key,
            <DataRowView
              row={row}
              rowKey={key}
              path={row.path}
              ownerOid={row.ownerOid}
              where={<WherePath row={row} onOpen={handlers.onOpen} />}
              narrow={narrow}
              locked={lockedKeys.has(key)}
              canEdit={canEdit}
              {...handlers}
            />
          )
        })}
      </div>
    </ScrollArea>
  )
}
