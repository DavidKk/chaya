'use client'

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button, NumberInput, NumberSliderInput, Tooltip } from '@/components/sk'

import type { EventsOp, EventsSlot } from '../events/types'

export const tableClass = '[&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1.5'
export const VITAL_COL = '12.5rem'
export const STATUS_COL = '5.5rem'
export const ACTIONS_COL = '8rem'
/** One card per side so enemies and party read as separate blocks */
export const cardClass = 'shrink-0 overflow-hidden rounded-[0.35rem] border border-line bg-panel'

/** Shadow root of the in-game overlay, so pickers portal inside it; null on the page */
export function portalHost(el: HTMLElement | null): Element | null {
  const root = el?.getRootNode()
  return typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? (root as unknown as Element) : null
}

/** Card title row; actions sit on the right */
export function SectionHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-2 border-b border-line px-3">
      <h3 className="m-0 flex-1 text-[0.8125rem] leading-[1.3] font-medium text-ink">{title}</h3>
      {children}
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
  disabledReason,
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
  disabledReason?: string
  onValue: (v: number) => void
  onMax: (v: number) => void
}) {
  const current = useCommit(value, onValue)
  const cap = useCommit(max, onMax)
  const field = (
    <span className="inline-flex" onKeyDownCapture={(e) => (current.onKeyDownCapture(e), cap.onKeyDownCapture(e))}>
      <NumberSliderInput
        className="w-[11rem]"
        value={current.value}
        min={0}
        max={max}
        disabled={disabled}
        aria-label={label}
        tooltip=""
        onSlideEnd={current.onSlideEnd}
        endAction={
          <span className="inline-flex items-center gap-1 text-ink-soft" data-slider-ignore>
            <span aria-hidden>/</span>
            <NumberInput
              className="h-5 w-[4.5rem] min-w-0 rounded-none border-none bg-transparent p-0 text-ink-soft focus:border-none focus:text-ink"
              value={cap.value}
              min={minMax}
              max={maxCap}
              disabled={disabled}
              aria-label={maxLabel}
              tooltip=""
              {...cap.input}
            />
          </span>
        }
        {...current.input}
      />
    </span>
  )
  return disabled && disabledReason ? <Tooltip content={disabledReason}>{field}</Tooltip> : field
}

/** Single committed number with a slider (TP) */
export function PlainInput({ value, max, label, disabled, onValue }: { value: number; max: number; label: string; disabled: boolean; onValue: (v: number) => void }) {
  const commit = useCommit(value, onValue)
  return (
    <span className="inline-flex" onKeyDownCapture={commit.onKeyDownCapture}>
      <NumberSliderInput
        className="w-[4.5rem]"
        value={commit.value}
        min={0}
        max={max}
        disabled={disabled}
        aria-label={label}
        tooltip=""
        onSlideEnd={commit.onSlideEnd}
        {...commit.input}
      />
    </span>
  )
}
