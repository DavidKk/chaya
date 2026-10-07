'use client'

import { type ReactNode, useState } from 'react'
import { BiReset } from 'react-icons/bi'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { GameEditHotkeysPane } from '@/components/game-edit/GameEditHotkeysPane'
import { type HotkeyMap, loadGameStoredHotkeys, loadGlobalHotkeys, saveGameStoredHotkeys, saveGlobalHotkeys } from '@/components/game-edit/run-hotkeys'
import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead, panelHeadEnd } from '@/components/layoutClasses'
import { Button, ScrollArea } from '@/components/sk'

import { useAssistRuleBindings } from './hotkey-conflicts'

type ViewProps = {
  gameValue: HotkeyMap
  globalValue: HotkeyMap
  onGameChange: (next: HotkeyMap) => void
  onGlobalChange: (next: HotkeyMap) => void
  actions?: ReactNode
}

/** Web 控制台与局内浮层共用；存储由外壳决定 */
export function AssistHotkeysView({ gameValue, globalValue, onGameChange, onGlobalChange, actions }: ViewProps) {
  const t = useT()
  const confirm = useConfirm()
  const assistBindings = useAssistRuleBindings()

  async function reset() {
    const ok = await confirm({
      title: t('edit.resetHotkeysTitle'),
      description: t('edit.resetHotkeysDesc'),
      confirmLabel: t('edit.resetHotkeysConfirm'),
      confirmVariant: 'fail',
    })
    if (!ok) return
    onGameChange({})
    onGlobalChange({})
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t('edit.hotkeys')}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">{t('edit.hotkeysDesc')}</p>
        </div>
        <div className={panelHeadEnd}>
          {actions}
          <Button variant="ghost" size="icon" aria-label={t('edit.resetHotkeys')} tooltip={t('edit.resetHotkeys')} onClick={() => void reset()}>
            <BiReset size={17} aria-hidden />
          </Button>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('edit.hotkeysAria') }}>
        <GameEditHotkeysPane gameValue={gameValue} globalValue={globalValue} onGameChange={onGameChange} onGlobalChange={onGlobalChange} assistBindings={assistBindings} />
      </ScrollArea>
    </div>
  )
}

export function AssistHotkeysPage() {
  const [gameHotkeys, setGameHotkeys] = useState<HotkeyMap>(loadGameStoredHotkeys)
  const [globalHotkeys, setGlobalHotkeys] = useState<HotkeyMap>(loadGlobalHotkeys)

  return (
    <AssistHotkeysView
      gameValue={gameHotkeys}
      globalValue={globalHotkeys}
      onGameChange={(next) => {
        saveGameStoredHotkeys(next)
        setGameHotkeys(next)
      }}
      onGlobalChange={(next) => {
        saveGlobalHotkeys(next)
        setGlobalHotkeys(next)
      }}
    />
  )
}
