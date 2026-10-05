'use client'

import { useSyncExternalStore } from 'react'
import { IoArrowUndoOutline, IoCheckmarkDone, IoLockClosed } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import type { DataStatus } from '@/lib/game/save-data'

import { draftStore } from './store'
import type { DataActions } from './useDataActions'

function usePendingCount() {
  useSyncExternalStore(draftStore.subscribeAll, draftStore.getVersion, () => 0)
  return draftStore.values().filter((d) => d.state !== 'stale').length
}

/** Pending drafts · apply all · clear · undo · data locks */
export function DataToolbar({ status, actions, disabled }: { status: DataStatus | null; actions: DataActions; disabled: boolean }) {
  const t = useT()
  const pending = usePendingCount()
  const total = useSyncExternalStore(
    draftStore.subscribeAll,
    () => draftStore.size,
    () => 0
  )
  const locks = status?.locks.length ?? 0
  const undoDepth = status?.undoDepth ?? 0

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {total ? <span className="text-xs text-ink-soft">{t('data.pending', { count: pending })}</span> : null}
      <Button variant="accent" disabled={disabled || !total} tooltip={t('data.applyAllTip')} onClick={() => void actions.applyDrafts()}>
        <IoCheckmarkDone size={15} aria-hidden />
        {t('data.applyAll')}
      </Button>
      <Button variant="ghost" disabled={!total} onClick={() => void actions.clearDrafts()}>
        {t('data.clearDrafts')}
      </Button>
      <Button
        variant="ghost"
        disabled={disabled || !undoDepth}
        tooltip={undoDepth ? t('data.undoTip', { summary: actions.undoLabel }) : t('data.undoEmpty')}
        onClick={() => void actions.undo()}
      >
        <IoArrowUndoOutline size={15} aria-hidden />
        {t('data.undo')}
        {undoDepth > 1 ? <span className="text-ink-soft">{undoDepth}</span> : null}
      </Button>
      {locks ? (
        <Button
          variant="ghost"
          disabled={disabled}
          tooltip={`${t('data.locksTip')}: ${status?.locks.map((l) => l.label || l.path[l.path.length - 1]).join(', ')}`}
          onClick={() => void actions.unlockAll()}
        >
          <IoLockClosed size={14} aria-hidden />
          {t('data.locks', { count: locks })} · {t('data.unlockAll')}
        </Button>
      ) : null}
    </div>
  )
}
