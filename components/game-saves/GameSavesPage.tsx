'use client'

import { type ReactNode, useMemo } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import {
  effectiveHotkeys,
  getGameHotkeysCache,
  isHotkeyDisabled,
  loadGameStoredHotkeys,
  loadGlobalHotkeys,
  QUICK_SAVE_SLOTS,
  quickSaveHotkeyId,
} from '@/components/game-edit/run-hotkeys'
import { useT } from '@/components/i18n/LocaleProvider'
import { panelHead } from '@/components/layoutClasses'
import { Button, EmptyState, ScrollArea } from '@/components/sk'
import { GAME_SAVES_WARN_BYTES, type GameSaveList, summarizeGameSaves } from '@/lib/game/game-saves'

import { AutoSaveCard } from './AutoSaveCard'
import { GameSavesSkeleton, ListSkeleton } from './GameSavesSkeleton'
import { useMiniPanelSwitches } from './MiniPanelSwitch'
import { QuickSaveCard, type QuickSlotHotkeys } from './QuickSaveCard'
import { useGameSaveActions } from './useGameSaveActions'
import { useGameSaves } from './useGameSaves'

/** 每个槽的有效快捷键；局内浮层取本游戏缓存，Web 取本地存储 */
function useQuickSaveHotkeys(): QuickSlotHotkeys[] {
  return useMemo(() => {
    const cached = getGameHotkeysCache()
    const map = effectiveHotkeys(Object.keys(cached).length ? cached : loadGameStoredHotkeys(), loadGlobalHotkeys())
    const chord = (id: string) => (isHotkeyDisabled(id) ? undefined : map[id])
    return Array.from({ length: QUICK_SAVE_SLOTS }, (_, slot) => ({ save: chord(quickSaveHotkeyId('save', slot)), load: chord(quickSaveHotkeyId('load', slot)) }))
  }, [])
}

type Props = {
  /** 跳到「辅助 › 快捷键」；Web 走路由，局内浮层切换分区 */
  onOpenHotkeys?: () => void
  /** 工具设置（迷你面板开关）的请求方式；局内浮层传插件请求 */
  request?: GameAgentRequest
}

/** 辅助 › 游戏存档：Web 控制台与局内浮层共用，只换外壳 */
export function GameSavesPage({ onOpenHotkeys, request }: Props = {}) {
  const t = useT()
  const quickHotkeys = useQuickSaveHotkeys()
  const saves = useGameSaves()
  const actions = useGameSaveActions(saves)
  const miniPanel = useMiniPanelSwitches(request)
  const { roomId, connected, ready, snapshot, statusAt, error, retry, thumb, settings, settingsReady } = saves
  const locked = !!actions.busyKey || !!snapshot?.status.busy
  const live = roomId && connected && ready ? snapshot : null
  const totals = live ? summarizeGameSaves(live.index) : null

  let placeholder: ReactNode = null
  if (!roomId) placeholder = <EmptyState title={t('saves.page.chooseGameTitle')} message={t('saves.page.chooseGameDesc')} />
  else if (!connected) placeholder = <EmptyState title={t('saves.page.connectTitle')} message={t('saves.page.connectDesc')} />
  else if (!live)
    placeholder = error ? (
      <EmptyState title={t('saves.page.loadFailedTitle')} message={error}>
        <Button className="mt-3" onClick={retry}>
          {t('common.retry')}
        </Button>
      </EmptyState>
    ) : (
      <ListSkeleton />
    )

  const listPlaceholder = (list: GameSaveList): ReactNode =>
    placeholder ??
    (live?.status.offline?.includes(list) ? (
      <EmptyState title={t('saves.storage.offlineTitle')} message={t('saves.storage.offlineDesc')}>
        <Button className="mt-3" onClick={retry}>
          {t('common.retry')}
        </Button>
      </EmptyState>
    ) : null)

  const body = !settingsReady ? (
    <GameSavesSkeleton />
  ) : (
    <>
      {error && (live || !connected) ? (
        <p role="alert" className="m-0 text-xs text-fail">
          {error}
        </p>
      ) : null}
      {totals && totals.autoBytes + totals.quickBytes > GAME_SAVES_WARN_BYTES ? (
        <p role="status" className="m-0 text-xs text-warn">
          {t('saves.page.sizeWarning')}
        </p>
      ) : null}
      <AutoSaveCard
        settings={settings}
        settingsReady={settingsReady}
        snapshot={live}
        statusAt={statusAt}
        actions={actions}
        thumb={thumb}
        locked={locked}
        placeholder={listPlaceholder('auto')}
        miniPanel={miniPanel}
      />
      <QuickSaveCard
        settings={settings}
        settingsReady={settingsReady}
        snapshot={live}
        actions={actions}
        thumb={thumb}
        locked={locked}
        hotkeys={quickHotkeys}
        placeholder={listPlaceholder('quick')}
        onOpenHotkeys={onOpenHotkeys}
        miniPanel={miniPanel}
      />
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t('nav.gameSaves')}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">{t('saves.page.subtitle')}</p>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('nav.gameSaves') }}>
        <div className="flex w-full max-w-3xl flex-col gap-4 p-4">{body}</div>
      </ScrollArea>
    </div>
  )
}
