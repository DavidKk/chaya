'use client'

import { useMemo } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { NumberInput, Select, SwitchToggle } from '@/components/sk'
import { type EventCommand, type FlowState, type ScriptRef, variableCandidates } from '@/lib/game/events'

/** Live game values for a script plus setters; null when offline */
export type ScriptLive = {
  state: FlowState
  canEdit: boolean
  onSwitch: (id: number, value: boolean) => void
  onVar: (id: number, value: number) => void
}

type Props = { target: ScriptRef; label: string; live: ScriptLive; list: readonly EventCommand[] }

/** Current value of the switch / variable a line touches, editable in place (self switches are not shown) */
export function ScriptValue({ target, label, live, list }: Props) {
  const t = useT()
  const disabled = !live.canEdit
  const blockedTip = disabled ? t('events.runNeedLink') : undefined

  const varId = target.kind === 'variable' ? target.id : 0
  const options = useMemo(() => {
    if (!varId) return []
    const cur = live.state.vars[varId] ?? 0
    return [...new Set([...variableCandidates(list, varId), cur])].sort((a, b) => a - b).map((v) => ({ value: String(v), label: String(v) }))
  }, [list, varId, live.state.vars])

  if (target.kind === 'switch') {
    const on = !!live.state.switches[target.id]
    return (
      <SwitchToggle
        checked={on}
        disabled={disabled}
        aria-label={label}
        tooltip={blockedTip ?? (on ? t('edit.toggleOff', { name: label }) : t('edit.toggleOn', { name: label }))}
        onCheckedChange={(next) => live.onSwitch(target.id, next)}
      />
    )
  }
  if (target.kind === 'self') return null
  const value = live.state.vars[target.id] ?? 0
  if (options.length > 1) {
    return (
      <Select
        className="w-20"
        value={String(value)}
        options={options}
        disabled={disabled}
        aria-label={label}
        panelWidth="content"
        onChange={(v) => live.onVar(target.id, Number(v))}
      />
    )
  }
  return <NumberInput className="w-20" value={value} disabled={disabled} aria-label={label} tooltip={blockedTip} onValueChange={(v) => live.onVar(target.id, v)} />
}
