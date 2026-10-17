'use client'

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button, NumberInput, NumberSliderInput, Tooltip } from '@/components/sk'

import type { EventsOp, EventsSlot } from '../events/types'
import { LockEndAction } from '../lock-ui'

export const tableClass = 'table-fixed [&_td]:px-2 [&_td]:py-1 [&_td]:align-middle [&_th]:px-2 [&_th]:py-1.5'
/** 百分比列宽，整表留在卡片内，锁和操作图标不再被裁掉 */
export const PARTY_COLS = { actor: '16%', hp: '26%', mp: '26%', tp: '14%', status: '8%', actions: '10%' } as const
export const ENEMY_COLS = { enemy: '28%', hp: '34%', status: '14%', actions: '24%' } as const
/** One card per side so enemies and party read as separate blocks */
export const cardClass = 'shrink-0 overflow-hidden rounded-[0.35rem] border border-line bg-panel'

type FieldLock = {
  locked: boolean
  name: string
  disabled?: boolean
  onChange: (on: boolean) => void
}

/** Shadow root of the in-game overlay, so pickers portal inside it; null on the page */
export function portalHost(el: HTMLElement | null): Element | null {
  const root = el?.getRootNode()
  return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? (root as unknown as Element) : null
}

/** Card title row; actions sit on the right */
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2 border-b border-line px-3">
      <h3 className="m-0 min-w-0 flex-1 text-[0.8125rem] leading-[1.3] font-medium text-ink">{title}</h3>
      {children ? <span className="inline-flex shrink-0 items-center gap-1">{children}</span> : null}
    </div>
  )
}

/** Icon action; the wrapper keeps a disabled button's tooltip trigger from shrinking in the row */
export function IconAction({
  label,
  tip,
  reason,
  busy,
  disabled,
  onClick,
  children,
}: {
  label: string
  tip?: string
  reason: string
  busy: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <span className="shrink-0">
      <Button variant="plain" size="mini" loading={busy} disabled={!!reason || disabled} aria-label={label} tooltip={reason || tip || label} onClick={onClick}>
        {children}
      </Button>
    </span>
  )
}

/** Keys of the ops still running; a slider commit can overlap an icon action */
export type BattleBusy = ReadonlySet<string>

/** Sends ops with a success / failure toast; `busy` holds the keys of the running ones */
export function useBattleRun(slot: EventsSlot) {
  const t = useT()
  const notify = useNotification()
  const counts = useRef(new Map<string, number>())
  const [busy, setBusy] = useState<BattleBusy>(() => new Set())
  const track = (key: string, delta: 1 | -1) => {
    const n = (counts.current.get(key) ?? 0) + delta
    if (n > 0) counts.current.set(key, n)
    else counts.current.delete(key)
    setBusy(new Set(counts.current.keys()))
  }
  async function run(key: string, op: EventsOp, ok: string) {
    track(key, 1)
    try {
      await slot.onAct(op)
      notify.success(ok)
    } catch (err) {
      notify.error(t('events.troop.battleFail', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      track(key, -1)
    }
  }
  return { busy, run }
}

/**
 * Applies on Enter / blur / slider release only (not per arrow step); Escape cancels.
 * The draft stays on screen until the game pushes the new value (or a few seconds pass, e.g. on failure).
 */
function useCommit(value: number, onApply: (v: number) => void) {
  const [draft, setDraftState] = useState<number | null>(null)
  const draftRef = useRef<number | null>(null)
  const cancelled = useRef(false)
  const setDraft = (v: number | null) => {
    draftRef.current = v
    setDraftState(v)
  }
  useEffect(() => setDraft(null), [value])
  useEffect(() => {
    if (draft == null) return
    const timer = window.setTimeout(() => setDraft(null), DRAFT_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [draft])
  const apply = () => {
    const v = draftRef.current
    if (cancelled.current || v == null || v === value) {
      setDraft(null)
      return
    }
    onApply(v)
  }
  return {
    value: draft ?? value,
    onKeyDownCapture: (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      cancelled.current = true
      setDraft(null)
    },
    input: {
      onFocus: () => {
        cancelled.current = false
      },
      onValueChange: (v: number) => setDraft(v),
      onBlur: apply,
    },
    onSlideEnd: (v: number) => {
      cancelled.current = false
      draftRef.current = v
      apply()
    },
  }
}

const DRAFT_HOLD_MS = 3000

/** Current / max in one field (like the actor HP field); both parts editable, the current value also slides */
export function VitalInput({
  value,
  max,
  maxCap,
  minMax = 1,
  label,
  maxLabel,
  disabled,
  maxDisabled,
  disabledReason,
  lock,
  maxLock,
  onValue,
  onMax,
}: {
  value: number
  max: number
  maxCap: number
  minMax?: number
  label: string
  maxLabel: string
  disabled: boolean
  /** 上限单独禁用；缺省时跟当前值一起禁用 */
  maxDisabled?: boolean
  disabledReason?: string
  lock?: FieldLock
  maxLock?: FieldLock
  onValue: (v: number) => void
  onMax: (v: number) => void
}) {
  const current = useCommit(value, onValue)
  const cap = useCommit(max, onMax)
  const currentDisabled = disabled || !!lock?.locked
  const capDisabled = (maxDisabled ?? disabled) || !!maxLock?.locked
  const field = (
    <span className="inline-flex items-center" onKeyDownCapture={(e) => (current.onKeyDownCapture(e), cap.onKeyDownCapture(e))}>
      <NumberSliderInput
        className="w-full min-w-0 max-w-full [&_input]:!min-w-0"
        value={current.value}
        min={0}
        max={max}
        disabled={currentDisabled}
        aria-label={label}
        tooltip=""
        onSlideEnd={current.onSlideEnd}
        endAction={
          <span className="inline-flex h-8 items-center gap-0.5 text-ink-soft" data-slider-ignore>
            {lock ? <LockEndAction locked={lock.locked} name={lock.name} disabled={lock.disabled} onChange={lock.onChange} /> : null}
            <span aria-hidden>/</span>
            <NumberInput
              className="h-8 w-[2.75rem] min-w-0 rounded-none border-none bg-transparent px-0 text-ink-soft focus:border-none focus:text-ink"
              value={cap.value}
              min={minMax}
              max={maxCap}
              disabled={capDisabled}
              aria-label={maxLabel}
              tooltip=""
              {...cap.input}
            />
            {maxLock ? <LockEndAction locked={maxLock.locked} name={maxLock.name} disabled={maxLock.disabled} onChange={maxLock.onChange} /> : null}
          </span>
        }
        {...current.input}
      />
    </span>
  )
  return currentDisabled && disabledReason ? <Tooltip content={disabledReason}>{field}</Tooltip> : field
}

/** Single committed number with a slider (TP) */
export function PlainInput({
  value,
  max,
  label,
  disabled,
  lock,
  onValue,
}: {
  value: number
  max: number
  label: string
  disabled: boolean
  lock?: FieldLock
  onValue: (v: number) => void
}) {
  const commit = useCommit(value, onValue)
  return (
    <span className="inline-flex items-center" onKeyDownCapture={commit.onKeyDownCapture}>
      <NumberSliderInput
        className="w-full min-w-0 max-w-full [&_input]:!min-w-0"
        value={commit.value}
        min={0}
        max={max}
        disabled={disabled || !!lock?.locked}
        aria-label={label}
        tooltip=""
        onSlideEnd={commit.onSlideEnd}
        {...commit.input}
        endAction={
          lock ? (
            <span data-slider-ignore>
              <LockEndAction locked={lock.locked} name={lock.name} disabled={lock.disabled} onChange={lock.onChange} />
            </span>
          ) : undefined
        }
      />
    </span>
  )
}
