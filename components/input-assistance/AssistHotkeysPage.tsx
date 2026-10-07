'use client'

import { useState } from 'react'

import { GameEditHotkeysPane, type HotkeyMap, loadGameStoredHotkeys, loadGlobalHotkeys, saveGameStoredHotkeys, saveGlobalHotkeys } from '@/components/game-edit'
import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { ScrollArea } from '@/components/sk'

export function AssistHotkeysPage() {
  const t = useT()
  const [gameHotkeys, setGameHotkeys] = useState<HotkeyMap>(loadGameStoredHotkeys)
  const [globalHotkeys, setGlobalHotkeys] = useState<HotkeyMap>(loadGlobalHotkeys)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t('edit.hotkeys')}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">{t('edit.hotkeysDesc')}</p>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('edit.hotkeysAria') }}>
        <GameEditHotkeysPane
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
      </ScrollArea>
    </div>
  )
}
