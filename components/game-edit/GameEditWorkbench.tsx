'use client'

import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react'
import { BiReset } from 'react-icons/bi'
import { IoCloseOutline, IoRefreshOutline } from 'react-icons/io5'
import { MdExposurePlus1 } from 'react-icons/md'
import { TbNumber99Small } from 'react-icons/tb'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { GameEditRunSettings } from '@/components/GameEditRunSettings'
import { useT } from '@/components/i18n/LocaleProvider'
import { editCell, editHeadCell, legalBar, panelBody, panelHead, panelHeadEnd, panelShell } from '@/components/layoutClasses'
import { LegalNotice, type LegalNoticeKind } from '@/components/legal/LegalNotice'
import { PanelHeadTitle } from '@/components/PanelHeadTitle'
import { Button, EmptyState, NumberInput, ScrollArea, Spinner, SwitchToggle, TruncateText } from '@/components/sk'
import { filterToggle, filterToggleOn } from '@/components/sk/control'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import type { CatalogEntry, GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { cn } from '@/lib/utils'

import type { EventsSlot } from './events/types'
import { GameEditMainNav } from './GameEditMainNav'
import { GameEditPaneSkeleton } from './GameEditPaneSkeleton'
import { GameEditSearch } from './GameEditSearch'
import { GameEditTabNav } from './GameEditTabNav'
import { LockEndAction, lockIconBtn } from './lock-ui'
import type { SaveDataSlot } from './save-data/transport'
import { type ActorPaneId, isEditTab, isEventsTab, type TabId, TABS } from './tabs'
import {
  type ActorDraft,
  type ActorVitalLockKind,
  countKey,
  GOLD_LOCK_KEY,
  hasCatalogName,
  type ItemKind,
  lockKeyForCount,
  lockKeyForSwitch,
  lockKeyForVar,
  matchFilter,
  MAX_ROWS,
  type RunActionId,
  type RunFlagKey,
  type SessionState,
  type TableRow,
} from './types'

/** 非默认 tab 懒加载，切到才解析对应模块 */
const ActorEditPane = lazy(() => import('./ActorEditPane').then((m) => ({ default: m.ActorEditPane })))
const GameEditHotkeysPane = lazy(() => import('./GameEditHotkeysPane').then((m) => ({ default: m.GameEditHotkeysPane })))
const GameEditTransPane = lazy(() => import('./GameEditTransPane').then((m) => ({ default: m.GameEditTransPane })))
const GameEditLogsPane = lazy(() => import('./GameEditLogsPane').then((m) => ({ default: m.GameEditLogsPane })))
const GameEditIntegrationPane = lazy(() => import('./GameEditIntegrationPane').then((m) => ({ default: m.GameEditIntegrationPane })))
const GameEditAboutPane = lazy(() => import('./GameEditAboutPane').then((m) => ({ default: m.GameEditAboutPane })))
const CommonEventsPane = lazy(() => import('./events/CommonEventsPane').then((m) => ({ default: m.CommonEventsPane })))
const MapPane = lazy(() => import('./events/MapPane').then((m) => ({ default: m.MapPane })))
const SaveDataPane = lazy(() => import('./save-data/SaveDataPane').then((m) => ({ default: m.SaveDataPane })))
const GameEditAgentSettingsPane = lazy(() => import('@/components/settings/GameEditAgentSettingsPane').then((m) => ({ default: m.GameEditAgentSettingsPane })))

function TabSuspense({ tab, children, translateSection, translateTab }: { tab: TabId; children: ReactNode; translateSection?: 'run' | 'cache'; translateTab?: 'play' | 'seed' }) {
  const t = useT()
  return <Suspense fallback={<GameEditPaneSkeleton tab={tab} label={t('edit.loadPanel')} translateSection={translateSection} translateTab={translateTab} />}>{children}</Suspense>
}

/** 固定轨宽：名称吃剩余空间；数值 / 状态列随内容 */
const editColsValueOnly = 'grid-cols-[2.75rem_minmax(0,1fr)_max-content]'

export type GameEditWorkbenchProps = {
  tab: TabId
  setTab: (tab: TabId) => void
  lastEditTab?: TabId
  /** 角色子页：角色 / 状态 / 技能（四级） */
  actorPane?: ActorPaneId
  setActorPane?: (pane: ActorPaneId) => void
  /** 选中人物 id（三级）；网页来自 URL，局内为本地状态 */
  actorId?: number | null
  setActorId?: (id: number) => void
  filter: string
  setFilter: (filter: string) => void
  onlyOwned: boolean
  setOnlyOwned: (onlyOwned: boolean) => void
  onlyNamed: boolean
  setOnlyNamed: (onlyNamed: boolean) => void
  translateTab?: 'play' | 'seed'
  setTranslateTab?: (tab: 'play' | 'seed') => void
  translateSection?: 'run' | 'cache'
  setTranslateSection?: (section: 'run' | 'cache') => void
  loading: boolean
  error: string
  catalog: GameEditCatalog | null
  session: SessionState
  onRefresh: () => void
  /** 局内浮层关闭；网页侧不传 */
  onClose?: () => void
  onGoldChange: (gold: number) => void
  onGoldLockChange: (on: boolean) => void
  onMoveRateChange: (rate: number) => void
  onGameSpeedChange: (rate: number) => void
  onExpRateChange: (rate: number) => void
  onRunFlagChange: (key: RunFlagKey, on: boolean) => void
  onRunAction: (id: RunActionId) => void
  onHotkeysChange?: (scope: 'game' | 'global', hotkeys: Record<string, string>) => void
  /** 快捷键页「刷新」：从存储重载本游戏 + 全部游戏 */
  onHotkeysReload?: () => void
  onCountChange: (kind: ItemKind, id: number, next: number) => void
  onVarChange: (id: number, next: number) => void
  onSwitchChange: (id: number, next: boolean) => void
  onRowLockChange: (row: TableRow, on: boolean) => void
  onActorChange: (id: number, patch: Partial<ActorDraft>) => void
  onActorOwnedLockChange?: (actorId: number, kind: 'skills' | 'states', entryId: number, on: boolean) => void
  onActorVitalLockChange?: (actorId: number, kind: ActorVitalLockKind, on: boolean) => void
  /**
   * 外壳差异（内容组件相同）：
   * - `page`：控制台 `/cheat/[tab]`，flush 无卡片；二级导航隐藏「翻译」（走顶栏）
   * - `overlay`：局内浮层，带卡片描边/阴影；保留「翻译」tab
   */
  surface?: 'page' | 'overlay'
  /** 网页侧是否已与游戏 DataChannel 连通（影响页脚提示） */
  linked?: boolean
  className?: string
  agentRequest?: GameAgentRequest
  /** 公共事件 / 地图 data and actions */
  events?: EventsSlot
  /** 数据页 transport and path */
  saveData?: SaveDataSlot
}

function isRowLocked(row: TableRow, locks: SessionState['locks']) {
  if (row.valueType === 'count' && row.kind) return lockKeyForCount(row.kind, row.id) in locks
  if (row.valueType === 'var') return lockKeyForVar(row.id) in locks
  if (row.valueType === 'sw') return lockKeyForSwitch(row.id) in locks
  return false
}

const lockBtn = lockIconBtn

const COUNT_MAX = 99

function clampCount(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.min(COUNT_MAX, Math.max(0, Math.floor(n)))
}

/** 输入框内小图标：disabled 时包 span 以便 hover 仍出 tooltip */
function InputIconBtn({
  tip,
  disabledTip,
  disabled,
  ariaLabel,
  onClick,
  children,
  className,
}: {
  tip: string
  disabledTip?: string
  disabled?: boolean
  ariaLabel: string
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  const inactive = !!disabled
  const btn = (
    <button type="button" className={cn(lockBtn, className)} aria-label={ariaLabel} disabled={inactive} onClick={onClick}>
      {children}
    </button>
  )
  return <Tooltip content={inactive && disabledTip ? disabledTip : tip}>{inactive ? <span className={cn('inline-flex', className)}>{btn}</span> : btn}</Tooltip>
}

/** 清零：与 +1 / 99 同显；已是 0 时禁用 */
function ClearIconBtn({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  const t = useT()
  return (
    <InputIconBtn tip={t('edit.clearZeroTip')} disabledTip={t('edit.alreadyZero')} disabled={disabled} ariaLabel={t('edit.clearZero')} onClick={onClick}>
      <IoCloseOutline size={15} aria-hidden />
    </InputIconBtn>
  )
}

export function GameEditWorkbench({
  tab,
  setTab,
  lastEditTab = 'run',
  actorPane = 'actor',
  setActorPane,
  actorId = null,
  setActorId,
  filter,
  setFilter,
  onlyOwned,
  setOnlyOwned,
  onlyNamed,
  setOnlyNamed,
  translateTab,
  setTranslateTab,
  translateSection,
  setTranslateSection,
  loading,
  error,
  catalog,
  session,
  onRefresh,
  onClose,
  onGoldChange,
  onGoldLockChange,
  onMoveRateChange,
  onGameSpeedChange,
  onExpRateChange,
  onRunFlagChange,
  onRunAction,
  onHotkeysChange,
  onHotkeysReload,
  onCountChange,
  onVarChange,
  onSwitchChange,
  onRowLockChange,
  onActorChange,
  onActorOwnedLockChange,
  onActorVitalLockChange,
  surface = 'page',
  linked = false,
  className,
  agentRequest,
  events,
  saveData,
}: GameEditWorkbenchProps) {
  const t = useT()
  const q = filter.trim().toLowerCase()
  const [transTick, setTransTick] = useState(0)
  const confirm = useConfirm()

  const rows = useMemo((): TableRow[] => {
    if (!catalog || tab === 'run' || tab === 'hotkeys' || tab === 'trans' || tab === 'actor') return []

    const mapItems = (kind: ItemKind, list: CatalogEntry[], ownedOnly: boolean): TableRow[] => {
      const out: TableRow[] = []
      for (const entry of list) {
        const count = session.counts[countKey(kind, entry.id)] ?? 0
        if (ownedOnly && count <= 0) continue
        if (onlyNamed && !hasCatalogName(entry.name)) continue
        const blob = `${entry.name} ${entry.description || ''} ${entry.id}`
        if (!matchFilter(blob, q)) continue
        out.push({
          id: entry.id,
          name: entry.name || t('edit.unnamedId', { id: entry.id }),
          meta: entry.description,
          value: count,
          kind,
          valueType: 'count',
        })
      }
      out.sort((a, b) => Number((b.value as number) > 0) - Number((a.value as number) > 0) || a.id - b.id)
      return out
    }

    if (tab === 'bag') {
      return [...mapItems('item', catalog.items, true), ...mapItems('weapon', catalog.weapons, true), ...mapItems('armor', catalog.armors, true)]
    }
    if (tab === 'item') return mapItems('item', catalog.items, onlyOwned)
    if (tab === 'weapon') return mapItems('weapon', catalog.weapons, onlyOwned)
    if (tab === 'armor') return mapItems('armor', catalog.armors, onlyOwned)

    if (tab === 'var') {
      const out: TableRow[] = []
      for (const entry of catalog.variables) {
        const value = session.vars[entry.id] ?? 0
        if (onlyNamed && !hasCatalogName(entry.name)) continue
        if (!matchFilter(`${entry.name} ${entry.id}`, q)) continue
        out.push({ id: entry.id, name: entry.name || t('edit.varFallback', { id: entry.id }), value, valueType: 'var' })
      }
      return out
    }

    if (tab === 'sw') {
      const out: TableRow[] = []
      for (const entry of catalog.switches) {
        const value = session.switches[entry.id] ?? false
        if (onlyNamed && !hasCatalogName(entry.name)) continue
        if (!matchFilter(`${entry.name} ${entry.id}`, q)) continue
        out.push({ id: entry.id, name: entry.name || t('edit.swFallback', { id: entry.id }), value, valueType: 'sw' })
      }
      return out
    }

    return []
  }, [catalog, onlyNamed, onlyOwned, q, session.counts, session.switches, session.vars, t, tab])

  const sourceCount = !catalog
    ? 0
    : tab === 'bag'
      ? catalog.items.length + catalog.weapons.length + catalog.armors.length
      : tab === 'item'
        ? catalog.items.length
        : tab === 'weapon'
          ? catalog.weapons.length
          : tab === 'armor'
            ? catalog.armors.length
            : tab === 'var'
              ? catalog.variables.length
              : tab === 'sw'
                ? catalog.switches.length
                : tab === 'actor'
                  ? catalog.actors.length
                  : 0
  const filtered = !!q || onlyNamed || (onlyOwned && (tab === 'item' || tab === 'weapon' || tab === 'armor'))
  const noMatch = sourceCount > 0 && filtered
  const visible = rows.slice(0, MAX_ROWS)
  const canLock = tab === 'bag' || tab === 'item' || tab === 'weapon' || tab === 'armor' || tab === 'var' || tab === 'sw'
  const showTableFilters = tab !== 'run' && tab !== 'hotkeys' && isEditTab(tab) && sourceCount > 0
  const showOwnedFilter = tab !== 'run' && tab !== 'actor'
  const goldLocked = GOLD_LOCK_KEY in session.locks
  const showEditNav = isEditTab(tab)
  const [paneHead, setPaneHead] = useState<HTMLDivElement | null>(null)
  const eventsTab = isEventsTab(tab)
  const eventSourceCount = !events?.data ? 0 : tab === 'map' ? events.data.mapIndex.nodes.length : events.data.events.length
  const activeTab = TABS.find((item) => item.id === tab)
  const legalKind: LegalNoticeKind | null =
    tab === 'logs' || tab === 'about' ? null : tab === 'trans' ? 'translate' : tab === 'mcp' ? 'integration' : tab === 'settings' ? 'agent' : 'edit'
  const refreshButton = (
    <Button
      variant="ghost"
      size="icon"
      loading={loading}
      aria-label={t('common.refresh')}
      tooltip={t('common.refresh')}
      onClick={() => {
        setTransTick((n) => n + 1)
        onRefresh()
        if (tab === 'hotkeys') onHotkeysReload?.()
      }}
    >
      <IoRefreshOutline size={17} aria-hidden />
    </Button>
  )
  const closeButton = onClose ? (
    <Button variant="ghost" size="icon" aria-label={t('common.close')} tooltip={t('edit.closeEsc')} onClick={onClose}>
      <IoCloseOutline size={17} aria-hidden />
    </Button>
  ) : null

  return (
    <div
      className={cn(
        panelShell,
        surface === 'overlay' && 'rounded-lg border border-line bg-[color-mix(in_oklab,var(--panel)_92%,transparent)] shadow-[0_12px_40px_rgb(0_0_0/0.45)]',
        className
      )}
      role="region"
      aria-label={t('edit.panelAria')}
    >
      {surface === 'overlay' ? <GameEditMainNav tab={tab} lastEditTab={lastEditTab} setTab={setTab} closeButton={closeButton} /> : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {surface === 'page' || showEditNav ? <GameEditTabNav tab={tab} setTab={setTab} surface={surface} /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {surface === 'page' || showEditNav ? (
            <div className={panelHead}>
              <PanelHeadTitle title={activeTab ? t(activeTab.labelKey) : t('edit.tabEdit')} description={tab === 'data' ? t('data.panelDesc') : t('edit.panelDesc')} />
              <div className={cn(panelHeadEnd, 'h-8 min-h-0 min-w-8 flex-1 shrink justify-end overflow-hidden')}>
                {showTableFilters || (eventsTab && eventSourceCount > 0) ? <GameEditSearch value={filter} onChange={setFilter} /> : null}
                {tab === 'data' || tab === 'map' ? <div ref={setPaneHead} className="flex min-w-0 shrink items-center" /> : null}
                {showTableFilters || tab === 'hotkeys' || surface === 'page' ? (
                  <ScrollArea
                    indicator="horizontal"
                    reserveGutter={false}
                    className="h-8 min-w-0 shrink"
                    scrollClassName="flex items-center"
                    scrollProps={{
                      'aria-label': t('edit.filtersAria'),
                      onWheel: (e) => {
                        const el = e.currentTarget
                        if (el.scrollWidth <= el.clientWidth + 1) return
                        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
                        e.preventDefault()
                        el.scrollLeft += e.deltaY
                      },
                    }}
                  >
                    <div className="ml-auto inline-flex h-8 w-max flex-nowrap items-center justify-end gap-2 pr-0.5 pl-1">
                      {showTableFilters ? (
                        <>
                          {showOwnedFilter ? (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={onlyOwned}
                              aria-label={t('edit.onlyOwned')}
                              className={cn(filterToggle, onlyOwned && filterToggleOn)}
                              onClick={() => setOnlyOwned(!onlyOwned)}
                            >
                              {t('edit.onlyOwned')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={onlyNamed}
                            aria-label={t('edit.onlyNamed')}
                            className={cn(filterToggle, onlyNamed && filterToggleOn)}
                            onClick={() => setOnlyNamed(!onlyNamed)}
                          >
                            {t('edit.onlyNamed')}
                          </button>
                        </>
                      ) : null}
                      {tab === 'hotkeys' ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('edit.resetHotkeys')}
                          tooltip={t('edit.resetHotkeys')}
                          onClick={() => {
                            void (async () => {
                              const ok = await confirm({
                                title: t('edit.resetHotkeysTitle'),
                                description: t('edit.resetHotkeysDesc'),
                                confirmLabel: t('edit.resetHotkeysConfirm'),
                                confirmVariant: 'fail',
                              })
                              if (!ok) return
                              onHotkeysChange?.('game', {})
                              onHotkeysChange?.('global', {})
                            })()
                          }}
                        >
                          <BiReset size={17} aria-hidden />
                        </Button>
                      ) : null}
                      {surface === 'page' ? refreshButton : null}
                    </div>
                  </ScrollArea>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className={isEditTab(tab) ? panelBody : 'flex min-h-0 flex-1 flex-col'}>
            {tab === 'run' ? (
              <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('edit.runSettingsAria') }}>
                <GameEditRunSettings
                  value={{
                    gold: session.gold,
                    goldLocked,
                    walkRate: session.walkRate,
                    gameSpeed: session.gameSpeed,
                    alwaysDash: session.alwaysDash,
                    fullscreen: session.fullscreen,
                    god: session.god,
                    through: session.through,
                    autotalk: session.autotalk,
                    encounter: session.encounter,
                    menuEnabled: session.menuEnabled,
                    saveEnabled: session.saveEnabled,
                    clickMove: session.clickMove,
                    followers: session.followers,
                    clickTeleport: session.clickTeleport,
                    resourceSkip: session.resourceSkip,
                    expRate: session.expRate,
                  }}
                  actionsEnabled={surface === 'overlay' || linked}
                  onGoldChange={onGoldChange}
                  onGoldLockChange={onGoldLockChange}
                  onMoveRateChange={onMoveRateChange}
                  onGameSpeedChange={onGameSpeedChange}
                  onExpRateChange={onExpRateChange}
                  onFlagChange={onRunFlagChange}
                  onAction={onRunAction}
                />
              </ScrollArea>
            ) : tab === 'hotkeys' ? (
              <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('edit.hotkeysAria') }}>
                <TabSuspense tab="hotkeys">
                  <GameEditHotkeysPane
                    gameValue={session.hotkeys}
                    globalValue={session.hotkeysGlobal}
                    onGameChange={(next) => onHotkeysChange?.('game', next)}
                    onGlobalChange={(next) => onHotkeysChange?.('global', next)}
                  />
                </TabSuspense>
              </ScrollArea>
            ) : tab === 'trans' ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <TabSuspense tab="trans" translateSection={translateSection} translateTab={translateTab}>
                  <GameEditTransPane
                    surface={surface}
                    refreshKey={transTick}
                    tab={translateTab}
                    onTabChange={setTranslateTab}
                    section={translateSection}
                    onSectionChange={setTranslateSection}
                  />
                </TabSuspense>
              </div>
            ) : tab === 'logs' ? (
              <TabSuspense tab="logs">
                <GameEditLogsPane />
              </TabSuspense>
            ) : tab === 'mcp' ? (
              <Suspense fallback={<Spinner size="sm" label={t('edit.loadPanel')} />}>
                <GameEditIntegrationPane request={agentRequest} />
              </Suspense>
            ) : tab === 'about' ? (
              <Suspense fallback={<Spinner size="sm" label={t('edit.loadPanel')} />}>
                <GameEditAboutPane />
              </Suspense>
            ) : tab === 'settings' && agentRequest ? (
              <Suspense fallback={<Spinner size="sm" label={t('edit.loadPanel')} />}>
                <GameEditAgentSettingsPane request={agentRequest} />
              </Suspense>
            ) : tab === 'data' ? (
              saveData ? (
                <TabSuspense tab="data">
                  <SaveDataPane slot={saveData} headSlot={paneHead} />
                </TabSuspense>
              ) : (
                <EmptyState title={t('data.needLink')} message={t('data.needLinkMsg')} />
              )
            ) : eventsTab ? (
              !events ? (
                <EmptyState title={t('events.needLink')} message={t('events.needLinkMsg')} />
              ) : (
                <TabSuspense tab={tab}>
                  {tab === 'common' ? (
                    <CommonEventsPane slot={events} filter={filter} session={session} />
                  ) : (
                    <MapPane slot={events} filter={filter} session={session} headSlot={paneHead} />
                  )}
                </TabSuspense>
              )
            ) : error ? (
              <EmptyState title={t('edit.catalogFailTitle')} message={error} hint={t('edit.catalogFailHint')} />
            ) : loading && !catalog ? (
              <GameEditPaneSkeleton tab={tab} />
            ) : isEditTab(tab) && sourceCount === 0 ? (
              <EmptyState title={t('edit.noData')} message={t('edit.noDataMsg')} />
            ) : tab === 'actor' && catalog ? (
              <TabSuspense tab="actor">
                <ActorEditPane
                  actors={catalog.actors}
                  skills={catalog.skills || []}
                  states={catalog.states || []}
                  classes={catalog.classes || []}
                  filter={filter}
                  onlyNamed={onlyNamed}
                  setOnlyNamed={setOnlyNamed}
                  drafts={session.actors}
                  locks={session.locks}
                  onOwnedLockChange={(kind, entryId, on) => {
                    if (actorId == null) return
                    onActorOwnedLockChange?.(actorId, kind, entryId, on)
                  }}
                  onVitalLockChange={(kind, on) => {
                    if (actorId == null) return
                    onActorVitalLockChange?.(actorId, kind, on)
                  }}
                  selectedId={actorId}
                  onSelectActor={setActorId ?? (() => {})}
                  pane={actorPane}
                  onPaneChange={setActorPane ?? (() => {})}
                  onChange={onActorChange}
                />
              </TabSuspense>
            ) : visible.length === 0 ? (
              <EmptyState
                title={noMatch ? t('edit.noMatch') : t('edit.noData')}
                message={noMatch ? t('edit.noMatchMsg') : t('edit.noDataMsg')}
                hint={noMatch ? t('edit.noMatchHint') : undefined}
              />
            ) : (
              <ScrollArea className="min-h-0 flex-1" indicator="both" scrollProps={{ 'aria-label': t('edit.editTableAria') }}>
                <div className="min-w-[36rem] text-[0.8125rem]" role="table" aria-label={t('edit.editTableAria')}>
                  <div className={cn('sticky top-0 z-[3] grid items-center border-b border-line bg-paper-2', editColsValueOnly)} role="row">
                    <div className={editHeadCell} role="columnheader">
                      ID
                    </div>
                    <div className={editHeadCell} role="columnheader">
                      名称
                    </div>
                    <div className={cn(editHeadCell, 'text-center')} role="columnheader">
                      {tab === 'sw' ? t('edit.colStatus') : t('edit.colValue')}
                    </div>
                  </div>
                  {visible.map((row, index) => {
                    const locked = isRowLocked(row, session.locks)
                    const lockAction =
                      canLock && (row.valueType === 'count' || row.valueType === 'var') ? (
                        <LockEndAction locked={locked} name={row.name} onChange={(on) => onRowLockChange(row, on)} />
                      ) : undefined
                    return (
                      <div
                        key={`${row.valueType}-${row.kind || 'x'}-${row.id}`}
                        className={cn(
                          'grid items-center border-t border-line hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]',
                          editColsValueOnly,
                          index === 0 && 'border-t-0'
                        )}
                        role="row"
                      >
                        <div className={cn(editCell, 'font-mono text-[0.75rem] text-ink-soft')} role="cell">
                          {row.id}
                        </div>
                        <div className={cn(editCell, 'min-w-0')} role="cell">
                          {row.meta ? (
                            <div className="flex h-[2.35rem] min-w-0 flex-col justify-center gap-0.5">
                              <TruncateText text={row.name} className="block font-medium leading-tight text-ink" />
                              <TruncateText text={row.meta} className="block text-[0.7rem] leading-[1.35] text-ink-soft" />
                            </div>
                          ) : (
                            <div className="flex h-[2.35rem] min-w-0 items-center">
                              <TruncateText text={row.name} className="block font-medium leading-tight text-ink" />
                            </div>
                          )}
                        </div>
                        <div className={cn(editCell, 'flex justify-center')} role="cell">
                          {row.valueType === 'count' && row.kind ? (
                            <NumberInput
                              value={row.value as number}
                              min={0}
                              max={COUNT_MAX}
                              tooltip={t('edit.countEdit', { max: COUNT_MAX })}
                              aria-label={t('edit.countOf', { name: row.name })}
                              onValueChange={(v) => onCountChange(row.kind!, row.id, clampCount(v))}
                              endAction={
                                <span className="inline-flex items-center gap-0.5">
                                  <InputIconBtn
                                    tip={t('edit.countInc')}
                                    disabledTip={t('edit.countAtMax', { max: COUNT_MAX })}
                                    disabled={(row.value as number) >= COUNT_MAX}
                                    ariaLabel={t('edit.countInc')}
                                    onClick={() => onCountChange(row.kind!, row.id, clampCount((row.value as number) + 1))}
                                  >
                                    <MdExposurePlus1 size={15} aria-hidden />
                                  </InputIconBtn>
                                  <InputIconBtn
                                    tip={t('edit.countMaxTip', { max: COUNT_MAX })}
                                    disabledTip={t('edit.countAtMaxIs', { max: COUNT_MAX })}
                                    disabled={(row.value as number) >= COUNT_MAX}
                                    ariaLabel={t('edit.countMaxTip', { max: COUNT_MAX })}
                                    onClick={() => onCountChange(row.kind!, row.id, COUNT_MAX)}
                                  >
                                    <TbNumber99Small size={17} aria-hidden />
                                  </InputIconBtn>
                                  <ClearIconBtn disabled={(row.value as number) === 0} onClick={() => onCountChange(row.kind!, row.id, 0)} />
                                  {lockAction}
                                </span>
                              }
                            />
                          ) : null}
                          {row.valueType === 'var' ? (
                            <NumberInput
                              value={row.value as number}
                              tooltip={t('edit.varEdit')}
                              aria-label={t('edit.varOf', { name: row.name })}
                              onValueChange={(v) => onVarChange(row.id, v)}
                              endAction={
                                <span className="inline-flex items-center gap-0.5">
                                  <ClearIconBtn disabled={(row.value as number) === 0} onClick={() => onVarChange(row.id, 0)} />
                                  {lockAction}
                                </span>
                              }
                            />
                          ) : null}
                          {row.valueType === 'sw' ? (
                            <span className="inline-flex items-center gap-2">
                              <SwitchToggle
                                checked={!!row.value}
                                aria-label={t('edit.switchOf', { name: row.name })}
                                tooltip={row.value ? t('edit.toggleOff', { name: row.name }) : t('edit.toggleOn', { name: row.name })}
                                onCheckedChange={(next) => onSwitchChange(row.id, next)}
                              />
                              <LockEndAction locked={locked} name={row.name} onChange={(on) => onRowLockChange(row, on)} />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
          {legalKind ? <LegalNotice kind={legalKind} link={surface === 'page'} className={legalBar} /> : null}
        </div>
      </div>
    </div>
  )
}
