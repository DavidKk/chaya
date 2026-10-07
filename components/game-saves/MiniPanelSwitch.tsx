'use client'

import { useCallback } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useT } from '@/components/i18n/LocaleProvider'
import { formControlInline, formDescInline, formFieldInlineDense, formTitleInline } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { SwitchToggle } from '@/components/sk/Switch'
import { readCachedToolSettings } from '@/lib/game-agent/tool-settings'
import { cn } from '@/lib/utils'

export type SavePanelField = 'autoSavePanelEnabled' | 'quickSavePanelEnabled'

export type MiniPanelSwitchState = {
  checked: (field: SavePanelField) => boolean
  /** 工具设置不可用（非本机模式）时的原因 */
  unavailable: string
  /** 保存开关失败的原因 */
  error: string
  busy: boolean
  loaded: boolean
  toggle: (field: SavePanelField, next: boolean, label: string) => void
}

/** 存档页的迷你面板开关：与迷你地图、旅伴 同存于工具设置 */
export function useMiniPanelSwitches(request?: GameAgentRequest): MiniPanelSwitchState {
  const { settings, busy, loaded, error, unavailable, update } = useToolSettings(request)
  const notify = useNotification()
  const t = useT()
  const toggle = useCallback(
    (field: SavePanelField, next: boolean, label: string) => {
      void update({ [field]: next }).then(() => {
        if (readCachedToolSettings()[field] === next) notify.success(t(next ? 'saves.mini.turnedOn' : 'saves.mini.turnedOff', { label }))
      })
    },
    [update, notify, t]
  )
  return {
    checked: (field) => settings[field],
    unavailable: unavailable ? t('saves.mini.unavailable') : '',
    error: unavailable ? '' : error,
    busy,
    loaded,
    toggle,
  }
}

type Props = {
  state: MiniPanelSwitchState
  field: SavePanelField
  /** 例如「自动存档面板」，用于开关提示与通知 */
  label: string
  className?: string
}

export function MiniPanelSwitchRow({ state, field, label, className }: Props) {
  const checked = state.checked(field)
  const t = useT()
  return (
    <div className={cn(formFieldInlineDense, 'grid-cols-[minmax(0,1fr)_auto]', className)}>
      <span className={formTitleInline}>{t('saves.mini.title')}</span>
      <span className={cn(formDescInline, state.error && 'text-fail')}>{state.unavailable || state.error || t('saves.mini.desc')}</span>
      <div className={formControlInline}>
        <SwitchToggle
          checked={checked}
          aria-label={t('saves.mini.show', { label })}
          tooltip={t(checked ? 'saves.mini.turnOff' : 'saves.mini.turnOn', { label })}
          disabled={!state.loaded || state.busy || !!state.unavailable}
          onCheckedChange={(next) => state.toggle(field, next, label)}
        />
      </div>
    </div>
  )
}
