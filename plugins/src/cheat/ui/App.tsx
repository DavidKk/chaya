import { Activity, lazy, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import {
  effectiveHotkeys,
  isHotkeyDisabled,
  matchKeyChord,
  parseHotkeyId,
  parseQuickSaveHotkeyId,
  saveGlobalHotkeys,
  setGameHotkeysCache,
  toolPanelFromHotkeyTarget,
} from '@/components/game-edit/run-hotkeys'
import { type ActorPaneId, isActorPaneId, isEditTab, isTabId, OVERLAY_MAIN_TABS, parseTabId, type TabId, usesEventsSlot } from '@/components/game-edit/tabs'
import {
  type ActorDraft,
  type ActorVitalLockKind,
  countKey,
  defaultActorDraft,
  emptySession,
  GOLD_LOCK_KEY,
  type ItemKind,
  lockKeyForActorSkill,
  lockKeyForActorState,
  lockKeyForActorVital,
  lockKeyForCount,
  lockKeyForSwitch,
  lockKeyForVar,
  type RunActionId,
  type RunFlagKey,
  type SessionState,
  type TableRow,
} from '@/components/game-edit/types'
import { isToolPanelId, toggleToolPanel } from '@/components/game-tools/tool-panels'
import { GameToolTransportContext } from '@/components/game-tools/transport'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useT } from '@/components/i18n/LocaleProvider'
import { NotificationProvider } from '@/components/notification/NotificationProvider'
import { EditTableSkeleton } from '@/components/sk'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import { isInputRecording } from '@/lib/game/input-assistance/recording'
import { readViewState, writeViewState } from '@/lib/view-state'

import { pluginGameAgentRequest } from '../../agent-ui/request'
import type { GameSavesController } from '../game-saves/controller'
import { applyGameSpeed, applyRunAction, applyRunFlag, applySpeed, runActionNeedsClose } from '../runtime/apply-run'
import { Cheats } from '../runtime/cheats'
import { RunCheats } from '../runtime/cheats-run'
import { buildLiveCatalog, type LiveSessionScope, readLiveSession, setItemCount, setPartyGold } from '../session/live-session'
import { bootstrapGameEditSession, diskStateFromSession, ensureGameEditDiskApplied, loadGameEditDisk, scheduleSaveGameEditDisk } from '../session/persist'
import { syncRemoteMirror } from '../session/remote-bridge'
import { FloatingGameSaves } from './FloatingGameSaves'
import { FloatingMiniMap } from './FloatingMiniMap'
import { FloatingPanelDock } from './FloatingPanelDock'
import { createPluginGameToolTransport } from './game-tool-transport'
import { useOverlayEvents } from './useOverlayEvents'
import { useOverlaySaveData } from './useOverlaySaveData'

/** 延迟拉 Workbench，首帧先出轻量占位，避免唤出时同步解析整树 */
const GameEditWorkbench = lazy(() => import('@/components/game-edit/GameEditWorkbench').then((m) => ({ default: m.GameEditWorkbench })))

type Props = {
  open: boolean
  onRequestOpen: () => void
  onRequestClose: () => void
}

type OverlayView = {
  tab: TabId
  lastEditTab: TabId
  actorId: number | null
  actorPane: ActorPaneId
  filter: string
  onlyOwned: boolean
  onlyNamed: boolean
  translateTab: 'play' | 'seed'
  translateSection: 'run' | 'cache'
}

function viewHost() {
  return window as Window & { __chayaGameEditView?: OverlayView }
}

function initialView(): OverlayView {
  const saved = viewHost().__chayaGameEditView ?? (readViewState('edit') as Partial<OverlayView> | undefined)
  const previousEditTab = parseTabId(saved?.lastEditTab ?? saved?.tab)
  return {
    tab: parseTabId(saved?.tab),
    lastEditTab: isEditTab(previousEditTab) ? previousEditTab : 'run',
    actorId: typeof saved?.actorId === 'number' && Number.isInteger(saved.actorId) && saved.actorId > 0 ? saved.actorId : null,
    actorPane: isActorPaneId(saved?.actorPane) ? saved.actorPane : 'actor',
    filter: typeof saved?.filter === 'string' ? saved.filter : '',
    onlyOwned: saved?.onlyOwned === true,
    onlyNamed: saved?.onlyNamed !== false,
    translateTab: saved?.translateTab === 'seed' ? 'seed' : 'play',
    translateSection: saved?.translateSection === 'cache' ? 'cache' : 'run',
  }
}

/** 首次从旧版热替换时，旧 React 树尚未写入状态，从仍在屏幕上的导航读取。 */
export function captureGameEditView() {
  const shadow = document.getElementById('chaya-game-edit-host')?.shadowRoot
  if (!shadow) return
  const saved = initialView()
  const activeTab =
    shadow.querySelector<HTMLElement>('[data-edit-categories] [role="tab"][aria-selected="true"]')?.dataset.navId ||
    shadow.querySelector<HTMLElement>('[data-active-tab]')?.dataset.activeTab
  const tab = activeTab || undefined
  // 旧热替换回退：用 data 属性，勿依赖多语言 aria 文案
  const mainTab = shadow.querySelector<HTMLElement>('[data-main-nav-id][aria-current="page"]')?.dataset.mainNavId
  const activeTranslateTab = shadow.querySelector<HTMLElement>('[role="tablist"][aria-label="翻译配置"] [role="tab"][aria-selected="true"]')?.dataset.navId
  const activeTranslateSection = shadow.querySelector<HTMLElement>('[role="tablist"][aria-label="翻译分区"] [role="tab"][aria-selected="true"]')?.dataset.navId
  // 新版写模块 id（translate / assist…），旧版写 tab id（trans / settings…）
  const mainPage = mainTab && mainTab in OVERLAY_MAIN_TABS ? OVERLAY_MAIN_TABS[mainTab as keyof typeof OVERLAY_MAIN_TABS] : mainTab
  viewHost().__chayaGameEditView = {
    ...saved,
    tab: isTabId(mainPage) && !isEditTab(mainPage) ? mainPage : parseTabId(tab, saved.tab),
    lastEditTab: isEditTab(parseTabId(tab, saved.lastEditTab)) ? parseTabId(tab, saved.lastEditTab) : saved.lastEditTab,
    translateTab: activeTranslateTab === 'seed' ? 'seed' : activeTranslateTab === 'play' ? 'play' : saved.translateTab,
    translateSection: activeTranslateSection === 'cache' ? 'cache' : activeTranslateSection === 'run' ? 'run' : saved.translateSection,
  }
}

function scopeForTab(tab: TabId): LiveSessionScope {
  if (tab === 'run' || tab === 'trans') return 'run'
  if (tab === 'bag' || tab === 'item' || tab === 'weapon' || tab === 'armor') return 'items'
  if (tab === 'var') return 'vars'
  if (tab === 'sw' || tab === 'common') return 'switches'
  if (tab === 'actor') return 'actors'
  if (tab === 'map') return 'full'
  return 'run'
}

function tabNeedsCatalog(tab: TabId): boolean {
  return tab !== 'run' && tab !== 'trans' && tab !== 'mcp' && tab !== 'settings' && tab !== 'about' && tab !== 'data' && !usesEventsSlot(tab)
}

/** In-game React panel: shared GameEditWorkbench + runtime data */
export function GameEditApp({ open, onRequestOpen, onRequestClose }: Props) {
  const t = useT()
  const [hasOpened, setHasOpened] = useState(open)
  useEffect(() => {
    if (open) setHasOpened(true)
  }, [open])
  const toolSettings = useToolSettings(pluginGameAgentRequest, 3000)
  const tRef = useRef(t)
  tRef.current = t
  const [initial] = useState(initialView)
  const [tab, setTab] = useState<TabId>(initial.tab)
  const [lastEditTab, setLastEditTab] = useState<TabId>(initial.lastEditTab)
  const selectTab = useCallback((next: TabId) => {
    setTab(next)
    if (isEditTab(next)) setLastEditTab(next)
  }, [])
  const [actorId, setActorId] = useState<number | null>(initial.actorId)
  const [actorPane, setActorPane] = useState<ActorPaneId>(initial.actorPane)
  const [filter, setFilter] = useState(initial.filter)
  const [onlyOwned, setOnlyOwned] = useState(initial.onlyOwned)
  const [onlyNamed, setOnlyNamed] = useState(initial.onlyNamed)
  const [translateTab, setTranslateTab] = useState<'play' | 'seed'>(initial.translateTab)
  const [translateSection, setTranslateSection] = useState<'run' | 'cache'>(initial.translateSection)
  useEffect(() => {
    const openSettings = () => setTab('settings')
    window.addEventListener('chaya:game-settings-opened', openSettings)
    return () => window.removeEventListener('chaya:game-settings-opened', openSettings)
  }, [])
  useLayoutEffect(() => {
    const view = { tab, lastEditTab, actorId, actorPane, filter, onlyOwned, onlyNamed, translateTab, translateSection }
    viewHost().__chayaGameEditView = view
    writeViewState('edit', view)
  }, [tab, lastEditTab, actorId, actorPane, filter, onlyOwned, onlyNamed, translateTab, translateSection])
  /** 先空会话出壳，打开后再异步 bootstrap，避免首帧卡在读盘 */
  const [session, setSession] = useState<SessionState>(() => emptySession())
  const [catalog, setCatalog] = useState<GameEditCatalog | null>(null)
  const [error, setError] = useState('')
  const [bootstrapping, setBootstrapping] = useState(false)
  const lastSavedRef = useRef('')
  const tabRef = useRef(tab)
  const catalogReadyRef = useRef(false)
  tabRef.current = tab

  const refresh = useCallback((explicitTab?: TabId) => {
    try {
      if (!$gameParty) {
        setCatalog(null)
        setError(tRef.current('edit.needSave'))
        return
      }
      ensureGameEditDiskApplied()
      const t = explicitTab ?? tabRef.current
      const scope = scopeForTab(t)
      if (tabNeedsCatalog(t)) {
        if (!catalogReadyRef.current) {
          setCatalog(buildLiveCatalog())
          catalogReadyRef.current = true
        }
      }
      setSession((prev) => {
        const live = readLiveSession(prev, scope)
        const disk = loadGameEditDisk()
        if (!disk) return live
        return { ...live, locks: { ...disk.locks, ...live.locks } }
      })
      setError('')
    } catch (err) {
      setCatalog(null)
      catalogReadyRef.current = false
      setError(err instanceof Error ? err.message : tRef.current('edit.readFailed'))
    }
  }, [])

  /** 打开：下一帧再 bootstrap + 轻量 refresh，先让 host 可见 */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setBootstrapping(true)
    const id = window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (cancelled) return
        try {
          Cheats.ensureHooks()
          const boot = bootstrapGameEditSession()
          setSession(boot)
          setGameHotkeysCache(boot.hotkeys)
          refresh(tabRef.current)
        } catch (err) {
          setError(err instanceof Error ? err.message : tRef.current('edit.initFailed'))
        } finally {
          if (!cancelled) setBootstrapping(false)
        }
      }, 0)
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [open, refresh])

  /** 面板打开时按当前 tab 定时刷新；关面板停表，且只扫当前 scope */
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => refresh(), 2000)
    return () => window.clearInterval(id)
  }, [open, refresh])

  /** 切 tab：只拉该页需要的数据；需要目录时才建 catalog */
  useEffect(() => {
    if (!open) return
    refresh(tab)
  }, [tab, open, refresh])

  useEffect(() => {
    if (!open) return
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== 'Escape' || isInputRecording()) return
      // ShadowRoot 会把 event.target 重定向为宿主；沿真实事件路径识别输入框。
      if (ev.composedPath().some((node) => node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA'))) return
      ev.preventDefault()
      onRequestClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onRequestClose])

  useEffect(() => {
    if (!open) return
    syncRemoteMirror(session)
  }, [session, open])

  useEffect(() => {
    if (!open) return
    const payload = JSON.stringify(diskStateFromSession(session))
    if (payload === lastSavedRef.current) return
    lastSavedRef.current = payload
    scheduleSaveGameEditDisk(diskStateFromSession(session))
  }, [session, open])

  const setGold = (n: number) => {
    setPartyGold(n)
    if (Cheats.isLocked('gold')) Cheats.updateLockValue('gold', 0, n)
    setSession((prev) => ({ ...prev, gold: Math.max(0, Math.floor(n)) }))
  }

  const setGoldLock = (on: boolean) => {
    Cheats.setLock('gold', 0, on, session.gold)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (on) locks[GOLD_LOCK_KEY] = prev.gold
      else delete locks[GOLD_LOCK_KEY]
      return { ...prev, locks }
    })
  }

  const setCount = (kind: ItemKind, id: number, next: number) => {
    setItemCount(kind, id, next)
    if (Cheats.isLocked(kind, id)) Cheats.updateLockValue(kind, id, next)
    const key = countKey(kind, id)
    setSession((prev) => ({ ...prev, counts: { ...prev.counts, [key]: Math.max(0, Math.floor(next)) } }))
  }

  const setVar = (id: number, next: number) => {
    if ($gameVariables) $gameVariables.setValue(id, Math.floor(next))
    if (Cheats.isLocked('var', id)) Cheats.updateLockValue('var', id, next)
    setSession((prev) => ({ ...prev, vars: { ...prev.vars, [id]: Math.floor(next) } }))
  }

  const setSwitch = (id: number, next: boolean) => {
    if ($gameSwitches) $gameSwitches.setValue(id, next)
    if (Cheats.isLocked('sw', id)) Cheats.updateLockValue('sw', id, next ? 1 : 0)
    const key = lockKeyForSwitch(id)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (key in locks) locks[key] = next ? 1 : 0
      return { ...prev, switches: { ...prev.switches, [id]: next }, locks }
    })
  }

  const setRowLock = (row: TableRow, on: boolean) => {
    if (row.valueType === 'count' && row.kind) {
      Cheats.setLock(row.kind, row.id, on, Number(row.value) || 0)
      const key = lockKeyForCount(row.kind, row.id)
      setSession((prev) => {
        const locks = { ...prev.locks }
        if (on) locks[key] = Number(row.value) || 0
        else delete locks[key]
        return { ...prev, locks }
      })
      return
    }
    if (row.valueType === 'var') {
      Cheats.setLock('var', row.id, on, Number(row.value) || 0)
      const key = lockKeyForVar(row.id)
      setSession((prev) => {
        const locks = { ...prev.locks }
        if (on) locks[key] = Number(row.value) || 0
        else delete locks[key]
        return { ...prev, locks }
      })
      return
    }
    if (row.valueType === 'sw') {
      Cheats.setLock('sw', row.id, on, row.value ? 1 : 0)
      const key = lockKeyForSwitch(row.id)
      setSession((prev) => {
        const locks = { ...prev.locks }
        if (on) locks[key] = row.value ? 1 : 0
        else delete locks[key]
        return { ...prev, locks }
      })
    }
  }

  const setActorOwnedLock = (actorId: number, kind: 'skills' | 'states', entryId: number, on: boolean) => {
    const key = kind === 'skills' ? lockKeyForActorSkill(actorId, entryId) : lockKeyForActorState(actorId, entryId)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (!on) {
        delete locks[key]
        return { ...prev, locks }
      }
      const draft = prev.actors[actorId]
      const owned = kind === 'skills' ? (draft?.skillIds || []).includes(entryId) : (draft?.stateIds || []).includes(entryId)
      locks[key] = owned ? 1 : 0
      return { ...prev, locks }
    })
  }

  const setActorVitalLock = (actorId: number, kind: ActorVitalLockKind, on: boolean) => {
    const draft = session.actors[actorId]
    const value = kind === 'level' ? (draft?.level ?? 1) : kind === 'exp' ? (draft?.exp ?? 0) : kind === 'hp' ? (draft?.hp ?? 0) : (draft?.mp ?? 0)
    Cheats.setLock(kind, actorId, on, value)
    const key = lockKeyForActorVital(kind, actorId)
    setSession((prev) => {
      const locks = { ...prev.locks }
      if (!on) {
        delete locks[key]
        return { ...prev, locks }
      }
      const d = prev.actors[actorId]
      locks[key] = kind === 'level' ? (d?.level ?? 1) : kind === 'exp' ? (d?.exp ?? 0) : kind === 'hp' ? (d?.hp ?? 0) : (d?.mp ?? 0)
      return { ...prev, locks }
    })
  }

  const setActor = (id: number, patch: Partial<ActorDraft>) => {
    const api = window.ChayaEdit?.actor?.(id)
    if (api) {
      if (patch.name != null) api.name?.(patch.name)
      if (patch.nickname != null) api.nickname?.(patch.nickname)
      if (patch.profile != null) api.profile?.(patch.profile)
      if (patch.level != null) api.level?.(patch.level)
      if (patch.exp != null) api.exp?.(patch.exp)
      if (patch.classId != null) api.classId?.(patch.classId)
      if (patch.hp != null) api.hp?.(patch.hp)
      if (patch.mp != null) api.mp?.(patch.mp)
      if (patch.mhp != null) api.mhp?.(patch.mhp)
      if (patch.mmp != null) api.mmp?.(patch.mmp)
      if (patch.atk != null) api.atk?.(patch.atk)
      if (patch.def != null) api.def?.(patch.def)
      if (patch.mat != null) api.mat?.(patch.mat)
      if (patch.mdf != null) api.mdf?.(patch.mdf)
      if (patch.agi != null) api.agi?.(patch.agi)
      if (patch.luk != null) api.luk?.(patch.luk)
      if (patch.skillIds) api.setSkills?.(patch.skillIds)
      if (patch.stateIds) api.setStates?.(patch.stateIds)
    }
    setSession((prev) => {
      const base = prev.actors[id] || defaultActorDraft(id)
      const next = { ...base, ...patch }
      const locks = { ...prev.locks }
      if (patch.skillIds) {
        const owned = new Set(next.skillIds)
        for (const key of Object.keys(locks)) {
          if (!key.startsWith(`actorSkill:${id}:`)) continue
          const skillId = Number(key.slice(`actorSkill:${id}:`.length))
          if (Number.isFinite(skillId)) locks[key] = owned.has(skillId) ? 1 : 0
        }
      }
      if (patch.stateIds) {
        const owned = new Set(next.stateIds)
        for (const key of Object.keys(locks)) {
          if (!key.startsWith(`actorState:${id}:`)) continue
          const stateId = Number(key.slice(`actorState:${id}:`.length))
          if (Number.isFinite(stateId)) locks[key] = owned.has(stateId) ? 1 : 0
        }
      }
      for (const kind of ['level', 'exp', 'hp', 'mp'] as const) {
        const key = lockKeyForActorVital(kind, id)
        if (!(key in locks)) continue
        const v = kind === 'level' ? next.level : kind === 'exp' ? next.exp : kind === 'hp' ? next.hp : next.mp
        locks[key] = v
        if (Cheats.isLocked(kind, id)) Cheats.updateLockValue(kind, id, v)
      }
      return { ...prev, actors: { ...prev.actors, [id]: next }, locks }
    })
  }

  const setRunFlag = (key: RunFlagKey, on: boolean) => {
    applyRunFlag(key, on)
    setSession((prev) => ({ ...prev, [key]: on }))
  }

  const runAction = (id: RunActionId) => {
    if (runActionNeedsClose(id)) onRequestClose()
    applyRunAction(id)
  }

  const setSwitchRef = useRef(setSwitch)
  setSwitchRef.current = setSwitch
  const onEventsSwitch = useCallback((id: number, value: boolean) => setSwitchRef.current(id, value), [])
  const setVarRef = useRef(setVar)
  setVarRef.current = setVar
  const onEventsVar = useCallback((id: number, value: number) => setVarRef.current(id, value), [])
  const { slot: eventsSlot } = useOverlayEvents({
    open,
    tab,
    selectTab,
    onClose: onRequestClose,
    onSwitchChange: onEventsSwitch,
    onVarChange: onEventsVar,
  })

  const saveDataSlot = useOverlaySaveData(open || hasOpened, tab)

  const hotkeyRef = useRef({ session, setRunFlag, runAction, toolSettings })
  hotkeyRef.current = { session, setRunFlag, runAction, toolSettings }

  useEffect(() => {
    setGameHotkeysCache(session.hotkeys)
  }, [session.hotkeys])

  /** In-game global hotkeys: work with panel open/closed; skip when an input is focused */
  useEffect(() => {
    function onHotkey(ev: KeyboardEvent) {
      if (isInputRecording()) return
      const target = ev.composedPath()[0]
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      const { session: cur, setRunFlag: setFlag, runAction: doAction, toolSettings: tools } = hotkeyRef.current
      const map = effectiveHotkeys(cur.hotkeys, cur.hotkeysGlobal)
      if (!map || !Object.keys(map).length) return
      for (const [id, chord] of Object.entries(map)) {
        if (!chord || isHotkeyDisabled(id) || !matchKeyChord(ev, chord)) continue
        const parsed = parseHotkeyId(id)
        if (!parsed) continue
        if (parsed.kind === 'ui') {
          const panel = toolPanelFromHotkeyTarget(parsed.target)
          if (!panel || !isToolPanelId(panel) || !tools.loaded || tools.unavailable) continue
          ev.preventDefault()
          ev.stopPropagation()
          if (!ev.repeat) void toggleToolPanel(panel, tools.settings, tools.update)
          break
        }
        const gameSaves = parsed.kind === 'save' ? (window as Window & { __chayaGameSaves?: GameSavesController }).__chayaGameSaves : undefined
        if (parsed.kind === 'save' && !gameSaves?.quickHotkeysEnabled()) continue
        ev.preventDefault()
        ev.stopPropagation()
        if (parsed.kind === 'save') {
          const quick = parseQuickSaveHotkeyId(parsed.target)
          if (quick && !ev.repeat) gameSaves?.hotkey(quick.action, quick.slot)
        } else if (parsed.kind === 'flag') {
          const key = parsed.target as RunFlagKey
          setFlag(key, !cur[key])
        } else {
          doAction(parsed.target as RunActionId)
        }
        break
      }
    }
    window.addEventListener('keydown', onHotkey, true)
    return () => window.removeEventListener('keydown', onHotkey, true)
  }, [])

  return (
    <GameEditOverlayProviders open={open}>
      <FloatingMiniMap
        enabled={toolSettings.settings.miniMapEnabled}
        onSelectEvent={(mapId, eventId) => {
          eventsSlot.onSelectMap(mapId, eventId)
          selectTab('map')
          onRequestOpen()
        }}
      />
      <FloatingGameSaves settings={toolSettings.settings} />
      <FloatingPanelDock tools={toolSettings} />
      {hasOpened ? (
        <Activity mode={open ? 'visible' : 'hidden'}>
          <Suspense fallback={<EditTableSkeleton label={t('edit.loadPanel')} />}>
            <GameEditWorkbench
              surface="overlay"
              agentRequest={pluginGameAgentRequest}
              tab={tab}
              setTab={selectTab}
              lastEditTab={lastEditTab}
              actorId={actorId}
              setActorId={setActorId}
              actorPane={actorPane}
              setActorPane={setActorPane}
              filter={filter}
              setFilter={setFilter}
              onlyOwned={onlyOwned}
              setOnlyOwned={setOnlyOwned}
              onlyNamed={onlyNamed}
              setOnlyNamed={setOnlyNamed}
              translateTab={translateTab}
              setTranslateTab={setTranslateTab}
              translateSection={translateSection}
              setTranslateSection={setTranslateSection}
              loading={bootstrapping}
              error={error}
              catalog={catalog}
              session={session}
              onClose={onRequestClose}
              onGoldChange={setGold}
              onGoldLockChange={setGoldLock}
              onMoveRateChange={(rate) => {
                applySpeed(rate, rate)
                setSession((prev) => ({ ...prev, walkRate: rate, runRate: rate }))
              }}
              onGameSpeedChange={(rate) => {
                applyGameSpeed(rate)
                setSession((prev) => ({ ...prev, gameSpeed: rate }))
              }}
              onExpRateChange={(rate) => {
                RunCheats.setExpRate(rate)
                setSession((prev) => ({ ...prev, expRate: rate }))
              }}
              onRunFlagChange={setRunFlag}
              onRunAction={runAction}
              onHotkeysChange={(scope, hotkeys) => {
                if (scope === 'game') {
                  setGameHotkeysCache(hotkeys)
                  setSession((prev) => ({ ...prev, hotkeys }))
                  return
                }
                saveGlobalHotkeys(hotkeys)
                setSession((prev) => ({ ...prev, hotkeysGlobal: hotkeys }))
              }}
              onCountChange={setCount}
              onVarChange={setVar}
              onSwitchChange={setSwitch}
              onRowLockChange={setRowLock}
              onActorChange={setActor}
              onActorOwnedLockChange={setActorOwnedLock}
              onActorVitalLockChange={setActorVitalLock}
              events={eventsSlot}
              saveData={saveDataSlot}
            />
          </Suspense>
        </Activity>
      ) : null}
    </GameEditOverlayProviders>
  )
}

/** Shadow 内挂弹层 Provider，保证浮层吃到 overlay token */
function GameEditOverlayProviders({ children, open }: { children: ReactNode; open: boolean }) {
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)
  const [inputAssist] = useState(createPluginGameToolTransport)
  return (
    <div ref={setPortalHost} className="relative flex min-h-0 flex-1 flex-col">
      <NotificationProvider portalContainer={portalHost}>
        <ConfirmProvider portalContainer={portalHost}>
          <GameToolTransportContext value={inputAssist}>
            <div className={open ? 'flex min-h-0 flex-1 flex-col' : 'contents'}>{children}</div>
          </GameToolTransportContext>
        </ConfirmProvider>
      </NotificationProvider>
    </div>
  )
}
