'use client'

import { useCallback } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import {
  type DataCell,
  type DataError,
  type DataOp,
  type DataPath,
  type DataPin,
  type DataStructAction,
  type DataStructResult,
  type DataUndoResult,
  type DataWriteItem,
  type DataWriteResult,
  isPrefix,
  parseDraft,
  pathExpression,
  pathKey,
  PINS_MAX,
  type PrimitiveValue,
  samePrimitive,
  type ValueType,
  WRITE_BATCH_MAX,
} from '@/lib/game/save-data'

import { cellText, errorText, undoText } from './labels'
import { type Draft, draftStore, markStale, writtenStore } from './store'
import type { SaveDataTransport } from './transport'
import type { SaveDataState } from './useSaveData'

type StructParams = { path: DataPath; ownerOid: number; action: DataStructAction; index?: number; key?: string; from?: number; valueType?: ValueType; value?: PrimitiveValue }

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Write-side actions of the data page: apply drafts, undo, locks, pins, structure changes */
export function useDataActions(transport: SaveDataTransport | null, state: SaveDataState) {
  const t = useT()
  const confirm = useConfirm()
  const notify = useNotification()
  const { status, reloadLevel, reloadPins } = state

  const run = useCallback(
    async (op: DataOp): Promise<unknown> => {
      if (!transport) throw new Error(t('data.needLink'))
      return transport.run(op)
    },
    [transport, t]
  )

  /** Apply the given drafts (default: every pending / failed one); validates the whole batch locally first */
  const applyDrafts = useCallback(
    async (keys?: string[]) => {
      const picked = (keys ?? draftStore.entries().map(([k]) => k)).map((key) => [key, draftStore.get(key)] as const).filter((e): e is readonly [string, Draft] => !!e[1])
      const stale = picked.filter(([, d]) => d.state === 'stale').length
      if (stale) {
        notify.warning(t('data.staleBlock', { count: stale }))
        return
      }
      if (!picked.length) return
      const items: { key: string; item: DataWriteItem; draft: Draft }[] = []
      let invalid = false
      for (const [key, draft] of picked) {
        const parsed = parseDraft(draft.raw, draft.type)
        if (!parsed.ok) {
          draftStore.set(key, { ...draft, state: 'error', error: t('data.invalidNumber') })
          invalid = true
          continue
        }
        items.push({ key, draft, item: { path: draft.path, ownerOid: draft.ownerOid, type: draft.type, value: parsed.value } })
      }
      if (invalid) return
      const risky = items.filter(({ draft, item }) => draft.confirm || item.value === null)
      if (risky.length) {
        const ok = await confirm({
          title: t('data.confirmTitle'),
          description: (
            <div className="flex flex-col gap-1.5 text-xs leading-[1.55]">
              <p className="m-0">{t('data.confirmDesc')}</p>
              <ul className="m-0 list-disc pl-5">
                {risky.map(({ key, draft, item }) => (
                  <li key={key} className="break-all">
                    {draft.label || pathExpression(draft.path)} → {item.value === null ? 'null' : String(item.value)}
                  </li>
                ))}
              </ul>
            </div>
          ),
          confirmLabel: t('data.confirmOk'),
          confirmVariant: 'warn',
        })
        if (!ok) return
        for (const r of risky) r.item.confirmed = true
      }

      let applied = 0
      let failed = 0
      try {
        for (let i = 0; i < items.length; i += WRITE_BATCH_MAX) {
          const batch = items.slice(i, i + WRITE_BATCH_MAX)
          const results = ((await run({ op: 'dataWrite', items: batch.map((b) => b.item) })) ?? []) as DataWriteResult[]
          batch.forEach(({ key, draft, item }, index) => {
            const result = results[index]
            const untouched = draftStore.get(key) === draft
            if (result?.ok) {
              applied++
              if (untouched) draftStore.delete(key)
              writtenStore.set(key, true)
              const back = result.readback
              if (back && !samePrimitive(back.value, item.value) && back.kind !== 'undefined') {
                notify.info(t('data.writeAdjusted', { name: draft.label || pathExpression(draft.path), value: cellText(t, back) }))
              }
              return
            }
            if (result && !result.code && !result.error) return
            failed++
            if (!untouched) return
            if (result?.code === 'stale') markStale(key)
            else draftStore.set(key, { ...draft, state: 'error', error: errorText(t, result?.code, result?.error) })
          })
        }
      } catch (err) {
        notify.error(t('data.actionFail', { error: errMessage(err) }))
        return
      }
      if (applied) notify.success(t('data.writeOk', { count: applied }))
      if (failed) notify.warning(t('data.writeFail', { count: failed }))
    },
    [run, confirm, notify, t]
  )

  const clearDrafts = useCallback(async () => {
    if (!draftStore.size) return
    const ok = await confirm({ title: t('data.clearDraftsTitle'), description: t('data.clearDraftsDesc'), confirmVariant: 'warn' })
    if (ok) draftStore.clear()
  }, [confirm, t])

  const undo = useCallback(async () => {
    try {
      let result = (await run({ op: 'dataUndo' })) as DataUndoResult
      if (!result.applied && result.conflicts?.length) {
        const ok = await confirm({
          title: t('data.undoConflictTitle'),
          description: (
            <div className="flex flex-col gap-1.5 text-xs leading-[1.55]">
              <p className="m-0">{t('data.undoConflictDesc')}</p>
              <ul className="m-0 list-disc pl-5">
                {result.conflicts.map((c) => (
                  <li key={pathKey(c.path)} className="break-all">
                    {c.label || pathExpression(c.path)}: {cellText(t, c.current)}
                  </li>
                ))}
              </ul>
            </div>
          ),
          confirmLabel: t('data.undoForce'),
          confirmVariant: 'warn',
        })
        if (!ok) return
        result = (await run({ op: 'dataUndo', force: true })) as DataUndoResult
      }
      if (result.applied) notify.success(t('data.undoDone'))
      else if (result.reason === 'replaced') notify.warning(t('data.undoReplaced'))
      else if (result.reason === 'struct-moved') notify.warning(t('data.undoMoved'))
      reloadLevel()
    } catch (err) {
      notify.error(t('data.actionFail', { error: errMessage(err) }))
    }
  }, [run, confirm, notify, t, reloadLevel])

  /** Lock with the row's pending draft (written first) or the current value */
  const setLock = useCallback(
    async (path: DataPath, ownerOid: number, on: boolean, label?: string) => {
      const key = pathKey(path)
      const draft = on ? draftStore.get(key) : undefined
      try {
        if (draft && draft.state !== 'stale') {
          const parsed = parseDraft(draft.raw, draft.type)
          if (!parsed.ok || parsed.value === null) {
            draftStore.set(key, { ...draft, state: 'error', error: t('data.invalidNumber') })
            return
          }
          if (draft.confirm) {
            const ok = await confirm({ title: t('data.confirmTitle'), description: `${label || pathExpression(path)} → ${String(parsed.value)}`, confirmVariant: 'warn' })
            if (!ok) return
          }
          const result = (await run({ op: 'dataLock', path, ownerOid, on, value: parsed.value, valueType: draft.type, confirmed: !!draft.confirm })) as DataWriteResult
          const untouched = draftStore.get(key) === draft
          if (!result?.ok) {
            if (!untouched) return
            if (result?.code === 'stale') markStale(key)
            else draftStore.set(key, { ...draft, state: 'error', error: errorText(t, result?.code, result?.error) })
            return
          }
          if (untouched) draftStore.delete(key)
          writtenStore.set(key, true)
          return
        }
        await run({ op: 'dataLock', path, ownerOid, on })
      } catch (err) {
        notify.error(t('data.lockFail', { error: errMessage(err) }))
      }
    },
    [run, confirm, notify, t]
  )

  const unlockAll = useCallback(async () => {
    const ok = await confirm({ title: t('data.unlockAllTitle'), description: t('data.unlockAllDesc'), confirmVariant: 'warn' })
    if (!ok) return
    try {
      await run({ op: 'dataUnlockAll' })
    } catch (err) {
      notify.error(t('data.actionFail', { error: errMessage(err) }))
    }
  }, [run, confirm, notify, t])

  const togglePin = useCallback(
    async (path: DataPath, label?: string) => {
      const pins: DataPin[] = status?.pins ?? []
      const key = pathKey(path)
      const exists = pins.some((p) => pathKey(p.path) === key)
      if (!exists && pins.length >= PINS_MAX) {
        notify.warning(t('data.pinsFull', { max: PINS_MAX }))
        return
      }
      const next = exists ? pins.filter((p) => pathKey(p.path) !== key) : [...pins, label ? { path, label } : { path }]
      try {
        await run({ op: 'dataPins', pins: next })
        reloadPins()
      } catch (err) {
        notify.error(t('data.actionFail', { error: errMessage(err) }))
      }
    },
    [status?.pins, run, notify, t, reloadPins]
  )

  /** Move user pin `from` to the position of `to` */
  const reorderPins = useCallback(
    async (from: DataPath, to: DataPath) => {
      const pins: DataPin[] = [...(status?.pins ?? [])]
      const a = pins.findIndex((p) => pathKey(p.path) === pathKey(from))
      const b = pins.findIndex((p) => pathKey(p.path) === pathKey(to))
      if (a < 0 || b < 0 || a === b) return
      const [moved] = pins.splice(a, 1)
      pins.splice(b, 0, moved)
      try {
        await run({ op: 'dataPins', pins })
        reloadPins()
      } catch (err) {
        notify.error(t('data.actionFail', { error: errMessage(err) }))
      }
    },
    [status?.pins, run, notify, t, reloadPins]
  )

  /** Structure change; drafts at or after the changed array index (and below them) go stale */
  const struct = useCallback(
    async (params: StructParams, confirmText?: { title: string; description: string }) => {
      if (confirmText) {
        const ok = await confirm({ ...confirmText, confirmVariant: 'fail' })
        if (!ok) return false
      }
      try {
        const result = (await run({ op: 'dataStruct', ...params, confirmed: !!confirmText })) as DataStructResult
        if (result?.index != null) {
          for (const [key, draft] of draftStore.entries()) {
            if (!isPrefix(result.path, draft.path) || draft.path.length <= result.path.length) continue
            const idx = Number(draft.path[result.path.length])
            if (Number.isInteger(idx) && idx >= result.index) markStale(key)
          }
        }
        reloadLevel()
        return true
      } catch (err) {
        notify.error(t('data.actionFail', { error: errorText(t, (err as DataError)?.code, errMessage(err)) }))
        return false
      }
    },
    [run, confirm, notify, t, reloadLevel]
  )

  const copyPath = useCallback(
    async (path: DataPath) => {
      const text = pathExpression(path)
      try {
        await navigator.clipboard.writeText(text)
        notify.success(t('data.pathCopied', { path: text }))
      } catch {
        notify.error(t('common.copyFailed'))
      }
    },
    [notify, t]
  )

  const readFull = useCallback(
    async (path: DataPath): Promise<DataCell | null> => {
      if (!transport) return null
      try {
        return await transport.read(path)
      } catch {
        return null
      }
    },
    [transport]
  )

  return { applyDrafts, clearDrafts, undo, setLock, unlockAll, togglePin, reorderPins, struct, copyPath, readFull, undoLabel: undoText(t, status?.undo ?? null) }
}

export type DataActions = ReturnType<typeof useDataActions>
