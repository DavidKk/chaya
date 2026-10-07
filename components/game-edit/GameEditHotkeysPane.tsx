'use client'

import { useMemo, useState } from 'react'
import { IoCloseOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense, formControlInline, formDescInline, formFieldInlineDense, formTitleInline } from '@/components/layoutClasses'
import { FORM_CONTROL_H, formControlChrome } from '@/components/sk/control'
import { SwitchToggle } from '@/components/sk/Switch'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import {
  canDisableHotkey,
  DEFAULT_OPEN_PANEL_CHORD,
  defaultOpenConsoleChord,
  displayKeyChord,
  formatKeyChord,
  type HotkeyMap,
  type HotkeyTarget,
  isStickyUiHotkeyId,
  loadDisabledHotkeys,
  OPEN_CONSOLE_HOTKEY_ID,
  OPEN_PANEL_HOTKEY_ID,
  resolveHotkeyChord,
  RUN_HOTKEY_TARGETS,
  saveDisabledHotkeys,
} from './run-hotkeys'

export type HotkeyScope = 'game' | 'global'

type Props = {
  gameValue: HotkeyMap
  globalValue: HotkeyMap
  onGameChange: (next: HotkeyMap) => void
  onGlobalChange: (next: HotkeyMap) => void
}

/** 左列加宽 + 描述不换行；右侧两列绑定框 */
const hotkeyRow = cn(formFieldInlineDense, 'grid-cols-[minmax(12rem,1fr)_auto]')
const hotkeyDesc = cn(formDescInline, 'whitespace-nowrap')
/** block + 子元素 absolute，避免 flex 把清除钮挤进文档流 */
export const hotkeyShell = cn(formControlChrome, FORM_CONTROL_H, 'relative block w-[9.5rem] shrink-0 overflow-hidden focus-within:border-accent')
/** leading-8 与 h-8 对齐，文字水平+垂直居中；铺满外壳，不受清除钮影响 */
export const hotkeyInput = cn(
  'absolute inset-0 z-0 m-0 box-border appearance-none rounded-none border-none bg-transparent px-2',
  'text-center font-inherit text-[0.8125rem] leading-8 text-ink tabular-nums outline-none',
  'placeholder:text-ink-soft'
)
/** 右侧留边距的清除钮；absolute 不占文档流，文案仍整框居中 */
export const hotkeyClearBtn = cn(
  'absolute top-1 right-1 bottom-1 z-[1] m-0 inline-flex w-[1.35rem] cursor-pointer items-center justify-center',
  'rounded-[0.15rem] border-none bg-transparent p-0 text-ink-soft',
  'outline-none hover:bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] hover:text-ink',
  'focus-visible:bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] focus-visible:text-ink'
)
const colHead = 'w-[9.5rem] shrink-0 text-center text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft uppercase'
/** 开关列：无标题，表头放总开关 */
const switchCol = 'ml-3 inline-flex w-8 shrink-0 items-center justify-center'

function stickyDefault(id: string): string {
  if (id === OPEN_PANEL_HOTKEY_ID) return DEFAULT_OPEN_PANEL_CHORD
  if (id === OPEN_CONSOLE_HOTKEY_ID) return defaultOpenConsoleChord()
  return ''
}

function applyBinding(map: HotkeyMap, id: string, chord: string, scope: HotkeyScope, other: HotkeyMap): HotkeyMap {
  const next = { ...map }
  const trimmed = chord.trim()

  if (!trimmed) {
    delete next[id]
  } else {
    for (const [k, v] of Object.entries(next)) {
      if (k !== id && v.toLowerCase() === trimmed.toLowerCase()) delete next[k]
    }
    next[id] = trimmed
  }

  const game = scope === 'game' ? next : other
  const global = scope === 'global' ? next : other
  for (const stickyId of [OPEN_PANEL_HOTKEY_ID, OPEN_CONSOLE_HOTKEY_ID]) {
    const chordSticky = resolveHotkeyChord(stickyId, game, global)
    for (const [k, v] of Object.entries(next)) {
      if (k !== stickyId && v.toLowerCase() === chordSticky.toLowerCase()) delete next[k]
    }
  }
  return next
}

type CellProps = {
  label: string
  scope: HotkeyScope
  chord: string
  placeholder: string
  recording: boolean
  showReset: boolean
  onRecord: (on: boolean) => void
  onBind: (chord: string) => void
  t: (key: MessageKey, params?: Record<string, string | number>) => string
}

function HotkeyBindCell({ label, scope, chord, placeholder, recording, showReset, onRecord, onBind, t }: CellProps) {
  const display = recording ? '…' : displayKeyChord(chord)
  const scopeLabel = scope === 'game' ? t('edit.hkScopeGame') : t('edit.hkScopeGlobal')
  const clearLabel = scope === 'game' ? t('edit.hkClearGame', { name: label }) : t('edit.hkClearGlobal', { name: label })
  return (
    <span className={cn(hotkeyShell, recording && 'border-accent')} data-recording={recording || undefined}>
      <input
        type="text"
        readOnly
        className={hotkeyInput}
        value={display}
        placeholder={displayKeyChord(placeholder) || placeholder}
        aria-label={t('edit.hkChordAria', { name: label, scope: scopeLabel })}
        onFocus={() => onRecord(true)}
        onBlur={() => onRecord(false)}
        onKeyDown={(e) => {
          if (!recording) return
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Backspace' || e.key === 'Delete') {
            onBind('')
            onRecord(false)
            ;(e.target as HTMLInputElement).blur()
            return
          }
          const next = formatKeyChord(e.nativeEvent)
          if (!next) return
          onBind(next)
          onRecord(false)
          ;(e.target as HTMLInputElement).blur()
        }}
      />
      {showReset ? (
        <button type="button" className={hotkeyClearBtn} aria-label={clearLabel} onMouseDown={(e) => e.preventDefault()} onClick={() => onBind('')}>
          <IoCloseOutline size={15} aria-hidden />
        </button>
      ) : null}
    </span>
  )
}

/** 运行开关 / 触发的快捷键：本游戏覆盖 | 全部游戏默认；未设本游戏则用全局 */
export function GameEditHotkeysPane({ gameValue, globalValue, onGameChange, onGlobalChange }: Props) {
  const t = useT()
  const [recordingKey, setRecordingKey] = useState<string | null>(null)
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(loadDisabledHotkeys)

  function setEnabled(ids: readonly string[], on: boolean) {
    const next = new Set(disabled)
    for (const id of ids) {
      if (on) next.delete(id)
      else if (canDisableHotkey(id)) next.add(id)
    }
    saveDisabledHotkeys(next)
    setDisabled(next)
  }

  const groups = useMemo(() => {
    const map = new Map<MessageKey, HotkeyTarget[]>()
    for (const row of RUN_HOTKEY_TARGETS) {
      const list = map.get(row.groupKey) || []
      list.push(row)
      map.set(row.groupKey, list)
    }
    return [...map.entries()]
  }, [])

  function setBinding(scope: HotkeyScope, id: string, chord: string) {
    if (scope === 'game') onGameChange(applyBinding(gameValue, id, chord, 'game', globalValue))
    else onGlobalChange(applyBinding(globalValue, id, chord, 'global', gameValue))
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-3 pb-4" role="region" aria-label={t('edit.hotkeysAria')}>
      {groups.map(([groupKey, rows]) => {
        const group = t(groupKey)
        const toggleIds = rows.map((row) => row.id).filter(canDisableHotkey)
        const offCount = toggleIds.filter((id) => disabled.has(id)).length
        const groupChecked = offCount === 0 ? true : offCount === toggleIds.length ? false : 'mixed'
        const groupTip = groupChecked === true ? t('edit.hkDisableAll', { group }) : t('edit.hkEnableAll', { group })
        return (
          <div key={groupKey} className={cn(formCardDense, 'm-0 w-full max-w-[64rem]')} aria-label={group}>
            <div className="flex items-center gap-3">
              <span className="text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft uppercase">{group}</span>
              <div className="ml-auto flex items-center gap-2">
                <span className={colHead} aria-hidden>
                  {t('edit.hkScopeGame')}
                </span>
                <span className={colHead} aria-hidden>
                  {t('edit.hkScopeGlobal')}
                </span>
                <span className={switchCol}>
                  {toggleIds.length ? (
                    <SwitchToggle variant="ghost" size="sm" checked={groupChecked} onCheckedChange={(on) => setEnabled(toggleIds, on)} aria-label={groupTip} tooltip={groupTip} />
                  ) : null}
                </span>
              </div>
            </div>
            {rows.map((row) => {
              const sticky = isStickyUiHotkeyId(row.id)
              const label = t(row.labelKey)
              const gameChord = String(gameValue[row.id] ?? '').trim()
              const globalChord = String(globalValue[row.id] ?? '').trim()
              const gameRecording = recordingKey === `game:${row.id}`
              const globalRecording = recordingKey === `global:${row.id}`
              const toggleable = canDisableHotkey(row.id)
              const enabled = !disabled.has(row.id)
              const toggleTip = !toggleable ? t('edit.hkPanelAlwaysOn') : enabled ? t('edit.hkDisable', { name: label }) : t('edit.hkEnable', { name: label })
              return (
                <div key={row.id} className={hotkeyRow}>
                  <span className={cn(formTitleInline, !enabled && 'opacity-50')}>{label}</span>
                  <span className={cn(hotkeyDesc, !enabled && 'opacity-50')}>{t(row.descKey)}</span>
                  <div className={cn(formControlInline, 'gap-2')}>
                    <HotkeyBindCell
                      label={label}
                      scope="game"
                      chord={gameChord}
                      placeholder="—"
                      recording={gameRecording}
                      showReset={Boolean(gameChord)}
                      onRecord={(on) => setRecordingKey(on ? `game:${row.id}` : null)}
                      onBind={(c) => setBinding('game', row.id, c)}
                      t={t}
                    />
                    <HotkeyBindCell
                      label={label}
                      scope="global"
                      chord={globalChord}
                      placeholder={sticky ? stickyDefault(row.id) : '—'}
                      recording={globalRecording}
                      showReset={Boolean(globalChord)}
                      onRecord={(on) => setRecordingKey(on ? `global:${row.id}` : null)}
                      onBind={(c) => setBinding('global', row.id, c)}
                      t={t}
                    />
                    <span className={switchCol}>
                      <SwitchToggle
                        variant="ghost"
                        size="sm"
                        checked={enabled}
                        disabled={!toggleable}
                        onCheckedChange={(on) => setEnabled([row.id], on)}
                        aria-label={toggleTip}
                        tooltip={toggleTip}
                      />
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
