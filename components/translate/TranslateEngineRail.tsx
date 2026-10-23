'use client'

import { Menu } from '@base-ui/react/menu'
import Link from 'next/link'
import { type DragEvent, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { IoAdd, IoCloseOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, ScrollArea, Tooltip } from '@/components/sk'
import { controlDisabled } from '@/components/sk/control'
import { dropdownItemClass, dropdownPopupClass, dropdownTriggerClass } from '@/components/sk/dropdownMenu'
import { AppleOfflineGuideModal } from '@/components/translate/AppleOfflineGuideModal'
import { BergamotPackInstaller } from '@/components/translate/BergamotPackInstaller'
import { TranslateAgentEntryConfig } from '@/components/translate/TranslateAgentEntryConfig'
import { TranslateEngineRow } from '@/components/translate/TranslateEngineRow'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { useTranslateAgentProfiles } from '@/components/translate/useTranslateAgentProfiles'
import { readApiErrorMessage } from '@/lib/api-error'
import type { MessageKey } from '@/lib/i18n'
import {
  agentEngineKey,
  DEFAULT_ENGINE_ORDER,
  DEFAULT_ENGINE_SETTINGS,
  DEFAULT_ENGINE_SWITCHES,
  engineGroup,
  findAgentEntry,
  isBuiltinEngineId,
  MAX_TRANSLATE_AGENTS,
  mergeEngineState,
  type TranslateAgentEntry,
  type TranslateBuiltinId,
  type TranslateEngineGroup,
  type TranslateEngineId,
  type TranslateEngineState,
  type TranslateEngineSwitches,
} from '@/lib/translate/engines'
import { formatLanguageLabel } from '@/lib/translate/locales-labels'
import { cn } from '@/lib/utils'

export type EngineId = TranslateEngineId

export type EngineSwitches = TranslateEngineSwitches

const BUILTIN_LABEL_KEY: Record<TranslateBuiltinId, MessageKey> = {
  bing: 'translate.engineBing',
  google: 'translate.engineGoogle',
  apple: 'translate.engineApple',
  bergamot: 'translate.engineBergamot',
}

const GROUPS: Array<{ id: TranslateEngineGroup; labelKey: MessageKey; descKey: MessageKey }> = [
  { id: 'agent', labelKey: 'translate.groupAgent', descKey: 'translate.groupAgentDesc' },
  { id: 'platform', labelKey: 'translate.groupPlatform', descKey: 'translate.groupPlatformDesc' },
  { id: 'system', labelKey: 'translate.groupSystem', descKey: 'translate.groupSystemDesc' },
]

const groupLabel = 'text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft uppercase'

type OfflineEngine = 'apple' | 'bergamot'
type OfflineStatus = { installed: boolean; status: string; message?: string; source?: string; target?: string; accessReason?: string; consoleUrl?: string }

type EngineView = Omit<TranslateEngineState, 'enabled'>

const INITIAL: EngineView = { switches: DEFAULT_ENGINE_SWITCHES, agents: [], order: DEFAULT_ENGINE_ORDER, configs: DEFAULT_ENGINE_SETTINGS }

function sameIds(a: EngineId[], b: EngineId[]) {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function enabledOf(view: EngineView): EngineId[] {
  return mergeEngineState({ ...view.switches, order: view.order, agents: view.agents }).enabled
}

function newEntryId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

type Props = {
  disabled?: boolean
  languagePair?: { source: string; target: string }
  className?: string
  onChange?: (switches: EngineSwitches, enabled: EngineId[]) => void
  /** 小屏抽屉是否打开（由父级控制） */
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
  /** 控制台里的 Agent 管理页；局内浮层不传 */
  manageAgentsHref?: string
  /** 是否作为独立整页展示（非侧边栏模式） */
  fullPage?: boolean
}

/** 翻译页左侧：Agent 组（用户添加的 Agent 实例）与翻译平台组；组内拖拽排序，先试 Agent 再试平台 */
export function TranslateEngineRail({ languagePair, disabled, className, onChange, mobileOpen = false, onMobileOpenChange, manageAgentsHref, fullPage = false }: Props) {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const agentProfiles = useTranslateAgentProfiles()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<EngineView>(INITIAL)
  const [systemStatus, setSystemStatus] = useState<Partial<Record<OfflineEngine, OfflineStatus>>>({})
  const [guideEngine, setGuideEngine] = useState<OfflineEngine | null>(null)
  const [appleGuideOpen, setAppleGuideOpen] = useState(false)
  const statusController = useRef<AbortController | null>(null)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuContainer, setAddMenuContainer] = useState<ShadowRoot>()
  const addAnchorRef = useRef<HTMLDivElement>(null)
  const [draggingId, setDraggingId] = useState<EngineId | null>(null)
  const [overId, setOverId] = useState<EngineId | null>(null)
  const [overEdge, setOverEdge] = useState<'before' | 'after'>('before')
  const enabledRef = useRef<EngineId[]>([])
  const dragGhostRef = useRef<HTMLElement | null>(null)
  const locked = loading || saving || !!disabled

  function closeMobile() {
    onMobileOpenChange?.(false)
  }

  function publish(next: EngineView) {
    const enabled = enabledOf(next).filter((id) => (id !== 'apple' && id !== 'bergamot') || systemStatus[id]?.installed === true)
    if (sameIds(enabledRef.current, enabled)) return
    enabledRef.current = enabled
    onChange?.(next.switches, enabled)
  }
  const publishEvent = useEffectEvent(publish)
  const reportError = useEffectEvent((message: string) => notify.error(message))

  function viewFrom(json: Partial<EngineView>, fallback: EngineView): EngineView {
    return {
      switches: json.switches ?? fallback.switches,
      agents: json.agents ?? fallback.agents,
      order: json.order?.length ? json.order : fallback.order,
      configs: json.configs ?? fallback.configs,
    }
  }

  const checkSystemStatus = useCallback(
    async (id: OfflineEngine, signal: AbortSignal) => {
      setSystemStatus((previous) => ({ ...previous, [id]: undefined }))
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ mode: `${id}-status`, from: languagePair?.source || undefined, to: languagePair?.target || undefined }),
        })
        const status = await res.json()
        if (!res.ok || status.ok === false) throw new Error(readApiErrorMessage(status, t('translate.offlineCheckFailed')))
        if (!signal.aborted) setSystemStatus((previous) => ({ ...previous, [id]: { ...status, installed: status.installed === true } }))
      } catch (error) {
        if (!signal.aborted)
          setSystemStatus((previous) => ({ ...previous, [id]: { installed: false, status: 'error', message: error instanceof Error ? error.message : undefined } }))
      }
    },
    [translationFetch, t, languagePair?.source, languagePair?.target]
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    statusController.current = controller
    setSystemStatus({})
    ;(async () => {
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'switches' }),
        })
        const json = (await res.json()) as Partial<EngineView> & { ok?: boolean; error?: unknown }
        if (cancelled) return
        if (!res.ok || json.ok === false) {
          reportError(readApiErrorMessage(json, t('translate.enginesLoadFailed')))
          return
        }
        const next = viewFrom(json, INITIAL)
        setView(next)
        for (const id of ['apple', 'bergamot'] as const) void checkSystemStatus(id, controller.signal)
        publishEvent(next)
      } catch (err) {
        if (!cancelled) reportError(err instanceof Error ? err.message : t('translate.enginesLoadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [t, translationFetch, checkSystemStatus])

  useEffect(() => {
    if (!loading) publishEvent(view)
  }, [systemStatus, view, loading])

  async function persist(patch: { switches?: Partial<EngineSwitches>; order?: EngineId[]; agents?: TranslateAgentEntry[] }, okMsg?: string) {
    setSaving(true)
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'switches', ...patch }),
      })
      const json = (await res.json()) as Partial<EngineView> & { ok?: boolean; error?: unknown }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.enginesSaveFailed')))
        return false
      }
      const next = viewFrom(json, view)
      setView(next)
      publish(next)
      if (okMsg) notify.success(okMsg)
      return true
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.enginesSaveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }

  function engineLabel(id: EngineId): string {
    if (isBuiltinEngineId(id)) return t(BUILTIN_LABEL_KEY[id])
    const entry = findAgentEntry(view.agents, id)
    const profile = agentProfiles.profiles.find((p) => p.id === entry?.profileId)
    return profile?.label ?? (agentProfiles.loading ? entry?.profileId || '' : t('translate.aiProfileMissing', { id: entry?.profileId ?? '' }))
  }

  function engineSubtitle(id: EngineId): string | undefined {
    const entry = findAgentEntry(view.agents, id)
    if (!entry) return undefined
    const profile = agentProfiles.profiles.find((p) => p.id === entry.profileId)
    return entry.model || profile?.defaultModel || t('translate.aiModelAuto')
  }

  async function toggle(id: EngineId, checked: boolean) {
    if (locked || (checked && (id === 'apple' || id === 'bergamot') && systemStatus[id]?.installed !== true)) return
    const name = engineLabel(id)
    const msg = t(checked ? 'translate.engineOn' : 'translate.engineOff', { name })
    if (isBuiltinEngineId(id)) {
      await persist({ switches: { [id]: checked } }, msg)
      return
    }
    const agents = view.agents.map((a) => (agentEngineKey(a.id) === id ? { ...a, enabled: checked } : a))
    await persist({ agents }, msg)
  }

  async function addAgent(profileId: string) {
    if (locked || view.agents.length >= MAX_TRANSLATE_AGENTS || view.agents.some((a) => a.profileId === profileId)) return
    const entry: TranslateAgentEntry = { id: newEntryId(), profileId, model: '', enabled: true }
    const name = agentProfiles.profiles.find((p) => p.id === profileId)?.label ?? profileId
    if (await persist({ agents: [...view.agents, entry] }, t('translate.agentAdded', { name }))) setOpenEntry(entry.id)
  }

  async function updateAgent(entryId: string, patch: Partial<TranslateAgentEntry>) {
    if (locked) return
    if (await persist({ agents: view.agents.map((a) => (a.id === entryId ? { ...a, ...patch } : a)) }, t('translate.agentSaved'))) setOpenEntry(null)
  }

  async function removeAgent(entryId: string) {
    if (locked) return
    const name = engineLabel(agentEngineKey(entryId))
    const agents = view.agents.filter((a) => a.id !== entryId)
    if (await persist({ agents }, t('translate.agentRemoved', { name }))) setOpenEntry(null)
  }

  function clearDrag() {
    setDraggingId(null)
    setOverId(null)
    if (dragGhostRef.current) {
      dragGhostRef.current.remove()
      dragGhostRef.current = null
    }
  }

  function onDragStart(id: EngineId, e: DragEvent<HTMLButtonElement>) {
    if (locked) {
      e.preventDefault()
      return
    }
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    const row = e.currentTarget.closest('li')
    if (row) {
      const ghost = row.cloneNode(true) as HTMLElement
      Object.assign(ghost.style, {
        position: 'fixed',
        top: '-9999px',
        left: '-9999px',
        width: `${row.getBoundingClientRect().width}px`,
        opacity: '0.92',
        pointerEvents: 'none',
        boxShadow: '0 10px 28px rgb(0 0 0 / 0.45)',
        transform: 'rotate(1.5deg) scale(1.02)',
        borderRadius: '0.35rem',
      })
      document.body.appendChild(ghost)
      dragGhostRef.current = ghost
      e.dataTransfer.setDragImage(ghost, 16, 20)
    }
  }

  /** 只允许组内拖拽：跨组顺序由「先 Agent 后平台」固定 */
  function onDragOver(id: EngineId, e: DragEvent<HTMLLIElement>) {
    if (!draggingId || draggingId === id || engineGroup(draggingId) !== engineGroup(id)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    setOverId(id)
    setOverEdge(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
  }

  async function onDrop(targetId: EngineId, e: DragEvent<HTMLLIElement>) {
    e.preventDefault()
    const sourceId = (e.dataTransfer.getData('text/plain') as EngineId) || draggingId
    const edge = overEdge
    clearDrag()
    if (!sourceId || locked || sourceId === targetId || engineGroup(sourceId) !== engineGroup(targetId)) return
    const next = view.order.filter((id) => id !== sourceId)
    const at = next.indexOf(targetId)
    if (at < 0) return
    next.splice(edge === 'after' ? at + 1 : at, 0, sourceId)
    if (sameIds(next, view.order)) return
    const prev = view
    setView({ ...view, order: next })
    if (!(await persist({ order: next }))) setView(prev)
  }

  useEffect(() => {
    if (!mobileOpen) return
    const mq = window.matchMedia('(max-width: 767px)')
    if (!mq.matches) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onMobileOpenChange?.(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen, onMobileOpenChange])

  function isChecked(id: EngineId) {
    return isBuiltinEngineId(id) ? view.switches[id] : !!findAgentEntry(view.agents, id)?.enabled
  }

  function renderRow(id: EngineId) {
    const entry = findAgentEntry(view.agents, id)
    const open = !!entry && openEntry === entry.id
    let badge: React.ReactNode = null
    if (id === 'bing' || id === 'google') {
      badge = (
        <Badge size="mini" tone="accent" dot={false}>
          {t('translate.tagFree')}
        </Badge>
      )
    } else if (id === 'apple' || id === 'bergamot') {
      const ready = systemStatus[id]?.installed === true
      badge = (
        <Badge size="mini" tone={ready ? 'ok' : 'warn'} loading={systemStatus[id] === undefined}>
          {systemStatus[id] === undefined ? t('translate.offlineChecking') : t(ready ? 'translate.tagReady' : 'translate.tagNotReady')}
        </Badge>
      )
    }
    return (
      <TranslateEngineRow
        key={id}
        label={engineLabel(id)}
        subtitle={engineSubtitle(id)}
        badge={badge}
        checked={isChecked(id)}
        locked={locked}
        toggleDisabled={(id === 'apple' || id === 'bergamot') && !isChecked(id) && systemStatus[id]?.installed !== true}
        dragging={draggingId === id}
        dropEdge={overId === id && draggingId && draggingId !== id ? overEdge : null}
        onToggle={(v) => void toggle(id, v)}
        onDragStart={(e) => onDragStart(id, e)}
        onDragEnd={clearDrag}
        onDragOver={(e) => onDragOver(id, e)}
        onDragLeave={() => overId === id && setOverId(null)}
        onDrop={(e) => void onDrop(id, e)}
        onEdit={entry ? () => setOpenEntry(open ? null : entry.id) : undefined}
        editing={open}
        actions={
          (id === 'apple' || id === 'bergamot') && (guideEngine === id || (systemStatus[id] && !systemStatus[id]?.installed)) ? (
            <Button size="xs" variant="plain" aria-expanded={guideEngine === id} onClick={() => setGuideEngine(guideEngine === id ? null : id)}>
              {t('translate.offlineGuide')}
            </Button>
          ) : undefined
        }
      >
        {(id === 'apple' || id === 'bergamot') && guideEngine === id ? (
          <div className="flex flex-col gap-2 text-xs leading-relaxed text-ink-soft">
            {systemStatus[id]?.source && systemStatus[id]?.target ? (
              <p className="m-0 font-medium text-ink">
                {formatLanguageLabel(systemStatus[id]!.source!)} → {formatLanguageLabel(systemStatus[id]!.target!)}
              </p>
            ) : null}
            {id === 'bergamot' && systemStatus[id]?.accessReason === 'management_required' ? (
              <p className="m-0">
                {systemStatus[id]?.consoleUrl ? (
                  <a href={systemStatus[id]!.consoleUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                    {t('translate.packConsoleRequired')}
                  </a>
                ) : (
                  t('translate.packConsoleRequired')
                )}
              </p>
            ) : id === 'bergamot' && systemStatus[id]?.source && systemStatus[id]?.target ? (
              <BergamotPackInstaller
                source={systemStatus[id]!.source!}
                target={systemStatus[id]!.target!}
                onInstalled={() => {
                  if (statusController.current) void checkSystemStatus(id, statusController.current.signal)
                }}
              />
            ) : (
              <>
                <p className="m-0">
                  {t(
                    systemStatus[id] === undefined
                      ? 'translate.offlineChecking'
                      : systemStatus[id]?.installed
                        ? 'translate.offlineReadyHint'
                        : systemStatus[id]?.status === 'supported'
                          ? 'translate.appleOfflinePackMissing'
                          : systemStatus[id]?.status === 'unsupported'
                            ? 'translate.offlineUnsupportedPair'
                            : systemStatus[id]?.status === 'model_pack_missing'
                              ? 'translate.bergamotPackMissing'
                              : id === 'bergamot' && systemStatus[id]?.status === 'unavailable'
                                ? 'translate.bergamotUnavailable'
                                : 'translate.offlineCheckFailed'
                  )}
                </p>
                {systemStatus[id]?.status === 'error' && systemStatus[id]?.message ? <p className="m-0 break-words text-[11px]">{systemStatus[id]?.message}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {id === 'apple' && systemStatus[id]?.status === 'supported' ? (
                    <Button size="xs" onClick={() => setAppleGuideOpen(true)}>
                      {t('translate.offlineGuide')}
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    disabled={systemStatus[id] === undefined}
                    onClick={() => {
                      if (statusController.current) void checkSystemStatus(id, statusController.current.signal)
                    }}
                  >
                    {t('translate.offlineRecheck')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : entry && open ? (
          <TranslateAgentEntryConfig
            entry={entry}
            agents={agentProfiles}
            takenProfileIds={view.agents.filter((a) => a.id !== entry.id).map((a) => a.profileId)}
            disabled={locked}
            onSave={(patch) => void updateAgent(entry.id, patch)}
            onCancel={() => setOpenEntry(null)}
            onRemove={() => void removeAgent(entry.id)}
          />
        ) : null}
      </TranslateEngineRow>
    )
  }

  const addDisabled = locked || view.agents.length >= MAX_TRANSLATE_AGENTS

  if (fullPage) {
    return (
      <div className={cn('flex flex-1 flex-col min-h-0 bg-paper-2 overflow-hidden', className)} aria-label={t('translate.platformsConfig')}>
        <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('translate.enginesList') }}>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
            {GROUPS.map((group) => {
              const ids = view.order.filter((id) => engineGroup(id) === group.id)
              return (
                <section key={group.id} className="flex flex-col rounded-lg border border-line bg-surface/30 overflow-hidden shadow-sm" aria-label={t(group.labelKey)}>
                  <div ref={group.id === 'agent' ? addAnchorRef : undefined} className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-4 bg-surface/40">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className={groupLabel}>{t(group.labelKey)}</span>
                        <span className="text-[0.68rem] tabular-nums text-ink-soft">{ids.length}</span>
                      </div>
                      <span className="truncate text-[0.7rem] leading-snug text-ink-soft/80">{t(group.descKey)}</span>
                    </div>
                    {group.id === 'agent' ? (
                      <Menu.Root
                        open={addMenuOpen}
                        onOpenChange={(open) => {
                          const root = addAnchorRef.current?.getRootNode()
                          if (open && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setAddMenuContainer(root)
                          setAddMenuOpen(open)
                        }}
                      >
                        <Tooltip content={t('translate.agentAddAria')} suppressed={addMenuOpen}>
                          <Menu.Trigger
                            aria-label={t('translate.agentAddAria')}
                            disabled={addDisabled}
                            className={cn(dropdownTriggerClass, 'size-7 justify-center p-0', controlDisabled)}
                          >
                            <IoAdd size={15} aria-hidden />
                          </Menu.Trigger>
                        </Tooltip>
                        <Menu.Portal container={addMenuContainer}>
                          <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[80]">
                            <Menu.Popup aria-label={t('translate.agentAddAria')} finalFocus={(type) => type === 'keyboard'} className={cn(dropdownPopupClass, 'max-w-[16rem]')}>
                              {agentProfiles.loading ? (
                                <Menu.Item disabled className={cn(dropdownItemClass, 'text-ink-soft')}>
                                  {t('common.loading')}
                                </Menu.Item>
                              ) : null}
                              {!agentProfiles.loading && !agentProfiles.profiles.length ? (
                                <Menu.Item disabled className={cn(dropdownItemClass, 'text-ink-soft')}>
                                  {agentProfiles.error ? t('translate.aiLoadFailed', { message: agentProfiles.error }) : t('translate.aiNoProfiles')}
                                </Menu.Item>
                              ) : null}
                              {agentProfiles.profiles.map((p) => {
                                const added = view.agents.some((a) => a.profileId === p.id)
                                return (
                                  <Menu.Item
                                    key={p.id}
                                    closeOnClick
                                    disabled={added}
                                    className={cn(dropdownItemClass, added && 'cursor-not-allowed opacity-50')}
                                    onClick={() => void addAgent(p.id)}
                                  >
                                    <span className="min-w-0 truncate">{p.label}</span>
                                    <span className="min-w-0 truncate text-[0.72rem] text-ink-soft">{added ? t('translate.agentAlreadyAdded') : p.defaultModel}</span>
                                  </Menu.Item>
                                )
                              })}
                              {manageAgentsHref ? (
                                <>
                                  <Menu.Separator className="mx-2 my-1 h-px bg-[rgb(230_238_248/0.08)]" />
                                  <Menu.Item render={<Link href={manageAgentsHref} />} className={cn(dropdownItemClass, 'text-ink-soft')}>
                                    {t('translate.aiManage')}
                                  </Menu.Item>
                                </>
                              ) : null}
                            </Menu.Popup>
                          </Menu.Positioner>
                        </Menu.Portal>
                      </Menu.Root>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    {group.id === 'agent' && agentProfiles.error ? (
                      <p className="m-0 text-[0.72rem] leading-snug text-ink-soft">{t('translate.aiLoadFailed', { message: agentProfiles.error })}</p>
                    ) : null}
                    {ids.length ? (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">{ids.map(renderRow)}</ul>
                    ) : (
                      <p className="m-0 rounded-[0.35rem] border border-dashed border-line px-3 py-3 text-[0.72rem] leading-snug text-ink-soft">{t('translate.agentEmpty')}</p>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        </ScrollArea>
        <AppleOfflineGuideModal
          open={appleGuideOpen}
          fromLang={systemStatus.apple?.source || 'ja'}
          toLang={systemStatus.apple?.target || 'zh'}
          onClose={() => setAppleGuideOpen(false)}
        />
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        className={cn('fixed inset-0 z-[65] cursor-default border-none bg-[rgb(0_0_0/0.45)] p-0 md:hidden', mobileOpen ? 'block' : 'hidden')}
        aria-label={t('translate.platformsClose')}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => closeMobile()}
      />
      <aside
        className={cn(
          'flex w-[21rem] max-w-[88vw] flex-col min-h-0 border-r border-line bg-paper-2',
          'md:relative md:shrink-0 md:translate-x-0',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[70] max-md:h-dvh max-md:shadow-[8px_0_28px_rgb(0_0_0/0.4)]',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:-translate-x-full',
          className
        )}
        aria-label={t('translate.platformsConfig')}
      >
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-line px-2 md:hidden">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('translate.enginesClose')} tooltip={t('common.close')} onClick={() => closeMobile()}>
            <IoCloseOutline size={16} aria-hidden />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('translate.enginesList') }}>
          {GROUPS.map((group) => {
            const ids = view.order.filter((id) => engineGroup(id) === group.id)
            return (
              <section key={group.id} className="flex flex-col" aria-label={t(group.labelKey)}>
                <div ref={group.id === 'agent' ? addAnchorRef : undefined} className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-line px-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className={groupLabel}>{t(group.labelKey)}</span>
                      <span className="text-[0.68rem] tabular-nums text-ink-soft">{ids.length}</span>
                    </div>
                    <span className="truncate text-[0.7rem] leading-snug text-ink-soft/80">{t(group.descKey)}</span>
                  </div>
                  {group.id === 'agent' ? (
                    <Menu.Root
                      open={addMenuOpen}
                      onOpenChange={(open) => {
                        const root = addAnchorRef.current?.getRootNode()
                        if (open && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setAddMenuContainer(root)
                        setAddMenuOpen(open)
                      }}
                    >
                      <Tooltip content={t('translate.agentAddAria')} suppressed={addMenuOpen}>
                        <Menu.Trigger
                          aria-label={t('translate.agentAddAria')}
                          disabled={addDisabled}
                          className={cn(dropdownTriggerClass, 'size-7 justify-center p-0', controlDisabled)}
                        >
                          <IoAdd size={15} aria-hidden />
                        </Menu.Trigger>
                      </Tooltip>
                      <Menu.Portal container={addMenuContainer}>
                        <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[80]">
                          <Menu.Popup aria-label={t('translate.agentAddAria')} finalFocus={(type) => type === 'keyboard'} className={cn(dropdownPopupClass, 'max-w-[16rem]')}>
                            {agentProfiles.loading ? (
                              <Menu.Item disabled className={cn(dropdownItemClass, 'text-ink-soft')}>
                                {t('common.loading')}
                              </Menu.Item>
                            ) : null}
                            {!agentProfiles.loading && !agentProfiles.profiles.length ? (
                              <Menu.Item disabled className={cn(dropdownItemClass, 'text-ink-soft')}>
                                {agentProfiles.error ? t('translate.aiLoadFailed', { message: agentProfiles.error }) : t('translate.aiNoProfiles')}
                              </Menu.Item>
                            ) : null}
                            {agentProfiles.profiles.map((p) => {
                              const added = view.agents.some((a) => a.profileId === p.id)
                              return (
                                <Menu.Item
                                  key={p.id}
                                  closeOnClick
                                  disabled={added}
                                  className={cn(dropdownItemClass, added && 'cursor-not-allowed opacity-50')}
                                  onClick={() => void addAgent(p.id)}
                                >
                                  <span className="min-w-0 truncate">{p.label}</span>
                                  <span className="min-w-0 truncate text-[0.72rem] text-ink-soft">{added ? t('translate.agentAlreadyAdded') : p.defaultModel}</span>
                                </Menu.Item>
                              )
                            })}
                            {manageAgentsHref ? (
                              <>
                                <Menu.Separator className="mx-2 my-1 h-px bg-[rgb(230_238_248/0.08)]" />
                                <Menu.Item render={<Link href={manageAgentsHref} />} className={cn(dropdownItemClass, 'text-ink-soft')}>
                                  {t('translate.aiManage')}
                                </Menu.Item>
                              </>
                            ) : null}
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.Root>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 border-b border-line p-4">
                  {group.id === 'agent' && agentProfiles.error ? (
                    <p className="m-0 text-[0.72rem] leading-snug text-ink-soft">{t('translate.aiLoadFailed', { message: agentProfiles.error })}</p>
                  ) : null}
                  {ids.length ? (
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">{ids.map(renderRow)}</ul>
                  ) : (
                    <p className="m-0 rounded-[0.35rem] border border-dashed border-line px-3 py-3 text-[0.72rem] leading-snug text-ink-soft">{t('translate.agentEmpty')}</p>
                  )}
                </div>
              </section>
            )
          })}
        </ScrollArea>
      </aside>
      <AppleOfflineGuideModal
        open={appleGuideOpen}
        fromLang={systemStatus.apple?.source || 'ja'}
        toLang={systemStatus.apple?.target || 'zh'}
        onClose={() => setAppleGuideOpen(false)}
      />
    </>
  )
}
