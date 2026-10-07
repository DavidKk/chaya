'use client'

import { useCallback, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { autoEntries, type GameSaveEntry, type GameSaveList, type GameSavesSettings } from '@/lib/game/game-saves'

import { formatFullTime, saveTitle } from './format'
import { GameSavesCommandError, type useGameSaves } from './useGameSaves'

type Saves = ReturnType<typeof useGameSaves>

/** 页面操作：确认框、「仍然保存」重试与错误展示 */
export function useGameSaveActions({ snapshot, command, setError, saveSettings }: Saves) {
  const confirm = useConfirm()
  const notify = useNotification()
  const t = useT()
  /** 页面发起、尚未完成的操作，例如 `save:auto`、`quick:3`、`load:<id>` */
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, body: () => Promise<unknown>): Promise<boolean> => {
      setBusyKey(key)
      try {
        await body()
        setError('')
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setBusyKey(null)
      }
    },
    [setError]
  )

  const withForce = useCallback(
    async (save: (force: boolean) => Promise<unknown>) => {
      try {
        await save(false)
      } catch (cause) {
        if (!(cause instanceof GameSavesCommandError) || cause.code !== 'unsafe') throw cause
        const ok = await confirm({ title: cause.message, description: t('saves.confirm.unsafeDesc'), confirmLabel: t('saves.confirm.saveAnyway'), confirmVariant: 'warn' })
        if (ok) await save(true)
      }
    },
    [confirm, t]
  )

  const saveAuto = useCallback(() => run('save:auto', () => withForce((force) => command({ op: 'save', target: 'auto', force }))), [run, withForce, command])

  const saveQuick = useCallback(
    async (slot: number, occupied: boolean) => {
      if (
        occupied &&
        !(await confirm({
          title: t('saves.confirm.overwriteTitle', { slot }),
          description: t('saves.confirm.overwriteDesc'),
          confirmLabel: t('saves.confirm.overwrite'),
          confirmVariant: 'warn',
        }))
      )
        return
      await run(`quick:${slot}`, () => withForce((force) => command({ op: 'save', target: 'quick', slot, force, source: 'page' })))
    },
    [run, withForce, command, confirm, t]
  )

  const load = useCallback(
    async (entry: GameSaveEntry) => {
      const mismatch = !!snapshot && !!entry.versionId && entry.versionId !== snapshot.versionId
      const from = entry.list === 'quick' ? t('saves.confirm.fromQuick', { slot: entry.slot ?? 0 }) : t('saves.confirm.fromAuto')
      const ok = await confirm({
        title: t('saves.confirm.loadTitle', { title: saveTitle(t, entry) }),
        description: `${t('saves.confirm.loadDesc', { from, time: formatFullTime(entry.savedAt) })}${mismatch ? t('saves.confirm.versionMismatch') : ''}`,
        confirmLabel: t('saves.confirm.load'),
        confirmVariant: mismatch ? 'warn' : 'accent',
      })
      if (!ok) return
      await run(`load:${entry.id}`, () => command({ op: 'load', entryId: entry.id, allowVersionMismatch: mismatch, source: 'page' }))
    },
    [snapshot, confirm, run, command, t]
  )

  const remove = useCallback(
    async (entry: GameSaveEntry) => {
      const title = entry.list === 'quick' ? t('saves.confirm.deleteSlotTitle', { slot: entry.slot ?? 0 }) : t('saves.confirm.deleteTitle', { title: saveTitle(t, entry) })
      if (!(await confirm({ title, description: t('saves.confirm.deleteDesc'), confirmLabel: t('saves.confirm.delete'), confirmVariant: 'fail' }))) return
      await run(`delete:${entry.id}`, () => command({ op: 'delete', entryId: entry.id }))
    },
    [confirm, run, command, t]
  )

  const clear = useCallback(
    async (list: GameSaveList) => {
      const count = snapshot?.index.entries.filter((e) => e.list === list).length ?? 0
      const ok = await confirm({
        title: t(list === 'auto' ? 'saves.confirm.clearAutoTitle' : 'saves.confirm.clearQuickTitle', { count }),
        description: t(list === 'auto' ? 'saves.confirm.clearAutoDesc' : 'saves.confirm.clearQuickDesc'),
        confirmLabel: t('saves.confirm.clear'),
        confirmVariant: 'fail',
      })
      if (ok) await run(`clear:${list}`, () => command({ op: 'clear', list }))
    },
    [snapshot, confirm, run, command, t]
  )

  const configure = useCallback(
    async (patch: Partial<GameSavesSettings>) => {
      const excess = snapshot && patch.maxCount !== undefined ? autoEntries(snapshot.index).length - patch.maxCount : 0
      if (excess > 0) {
        const ok = await confirm({
          title: t('saves.confirm.trimTitle', { count: excess }),
          description: t('saves.confirm.trimDesc'),
          confirmLabel: t('saves.confirm.trimConfirm'),
          confirmVariant: 'fail',
        })
        if (!ok) return
      }
      if (!(await run('configure', () => saveSettings(patch)))) return
      if (patch.enabled !== undefined) notify.success(t(patch.enabled ? 'saves.auto.enabled' : 'saves.auto.disabled'))
      if (patch.quickEnabled !== undefined) notify.success(t(patch.quickEnabled ? 'saves.quick.enabled' : 'saves.quick.disabled'))
      if (patch.autoStorage) notify.success(t('saves.storage.changedAuto', { place: t(`saves.storage.${patch.autoStorage}`) }))
      if (patch.quickStorage) notify.success(t('saves.storage.changedQuick', { place: t(`saves.storage.${patch.quickStorage}`) }))
    },
    [snapshot, confirm, run, saveSettings, notify, t]
  )

  return { busyKey, saveAuto, saveQuick, load, remove, clear, configure }
}
