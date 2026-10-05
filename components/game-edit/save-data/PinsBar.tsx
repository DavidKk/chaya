'use client'

import { type ReactNode, useState } from 'react'
import { MdDragIndicator } from 'react-icons/md'

import { useT } from '@/components/i18n/LocaleProvider'
import { TextAction } from '@/components/sk'
import { type DataPath, type DataRowAt, pathExpression, pathKey } from '@/lib/game/save-data'
import { cn } from '@/lib/utils'

import { DataListHeader, type RowHandlers } from './DataList'
import { DataRowView, ROW_HEIGHT, ROW_HEIGHT_NARROW } from './DataRowView'
import { segmentName, type T } from './labels'
import type { PinRow } from './useSaveData'

export function whereText(t: T, row: Pick<DataRowAt, 'path' | 'labels'>): string {
  return row.path
    .slice(0, -1)
    .map((seg, i) => segmentName(t, seg, row.labels[i], i))
    .join(' › ')
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

/** Preset + user pins shown as regular rows above the level list; user pins can be dragged to reorder */
export function PinsBar({ rows, userPins, narrow, lockedKeys, canEdit, onUnpin, onReorder, ...handlers }: Props) {
  const t = useT()
  const [dragging, setDragging] = useState<DataPath | null>(null)
  const [over, setOver] = useState<string | null>(null)
  if (!rows.length) return null
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
    <section className="shrink-0 border-b border-line" aria-label={t('data.pinsTitle')}>
      <div className="px-3 pt-2 pb-1 text-[0.7rem] font-medium text-ink-soft">{t('data.pinsTitle')}</div>
      <DataListHeader narrow={narrow} className="pl-7" />
      <div className="max-h-[30vh] overflow-auto overscroll-contain" role="list">
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
              where={whereText(t, row)}
              narrow={narrow}
              locked={lockedKeys.has(key)}
              canEdit={canEdit}
              {...handlers}
            />
          )
        })}
      </div>
    </section>
  )
}
