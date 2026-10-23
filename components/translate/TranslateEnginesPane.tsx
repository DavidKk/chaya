'use client'

import { Menu } from '@base-ui/react/menu'
import Link from 'next/link'
import { type DragEvent, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { IoAdd, IoSettingsOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Badge, Button, ScrollArea, Tooltip } from '@/components/sk'
import { controlDisabled } from '@/components/sk/control'
import { dropdownItemClass, dropdownPopupClass, dropdownTriggerClass } from '@/components/sk/dropdownMenu'
import { useSafePathname, useSafeRouter, useSafeSearchParams } from '@/components/translate/safe-navigation'
import { type EngineDetailDraft, TranslateEngineDetailView } from '@/components/translate/TranslateEngineDetailView'
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
  type TranslateEngineSettings,
  type TranslateEngineState,
  type TranslateEngineSwitches,
} from '@/lib/translate/engines'
import { patchSearchParams } from '@/lib/url/search-params'
import { cn } from '@/lib/utils'

type EngineId = TranslateEngineId
type OfflineEngine = 'apple' | 'bergamot'
type OfflineStatus = { installed: boolean; status: string; message?: string; source?: string; target?: string; accessReason?: string; consoleUrl?: string }

type EngineView = Omit<TranslateEngineState, 'enabled'>

const INITIAL: EngineView = {
  switches: DEFAULT_ENGINE_SWITCHES,
  agents: [],
  order: DEFAULT_ENGINE_ORDER,
  configs: DEFAULT_ENGINE_SETTINGS,
}

const GROUPS: Array<{ id: TranslateEngineGroup; labelKey: MessageKey; descKey: MessageKey }> = [
  { id: 'agent', labelKey: 'translate.groupAgent', descKey: 'translate.groupAgentDesc' },
  { id: 'platform', labelKey: 'translate.groupPlatform', descKey: 'translate.groupPlatformDesc' },
  { id: 'system', labelKey: 'translate.groupSystem', descKey: 'translate.groupSystemDesc' },
]

const BUILTIN_LABEL_KEY: Record<TranslateBuiltinId, MessageKey> = {
  bing: 'translate.engineBing',
  google: 'translate.engineGoogle',
  apple: 'translate.engineApple',
  bergamot: 'translate.engineBergamot',
}

const groupLabel = 'text-[0.72rem] font-semibold tracking-[0.04em] text-ink-soft uppercase'

function newEntryId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function TranslateEnginesPane({ manageAgentsHref = '/assist/agents' }: { manageAgentsHref?: string }) {
  const t = useT()
  const router = useSafeRouter()
  const pathname = useSafePathname()
  const searchParams = useSafeSearchParams()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const agentProfiles = useTranslateAgentProfiles()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<EngineView>(INITIAL)
  const [systemStatus, setSystemStatus] = useState<Partial<Record<OfflineEngine, OfflineStatus>>>({})
  const statusController = useRef<AbortController | null>(null)

  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addMenuContainer, setAddMenuContainer] = useState<ShadowRoot>()
  const addAnchorRef = useRef<HTMLDivElement>(null)

  const [draggingId, setDraggingId] = useState<EngineId | null>(null)
  const [overId, setOverId] = useState<EngineId | null>(null)
  const [overEdge, setOverEdge] = useState<'before' | 'after'>('before')
  const dragGhostRef = useRef<HTMLElement | null>(null)

  // Active selected engine for Detail View
  const engineParam = searchParams?.get('engine') as EngineId | null
  const [localEngineId, setLocalEngineId] = useState<EngineId | null>(null)
  const selectedEngineId = localEngineId ?? (engineParam || null)

  const selectEngine = useCallback(
    (id: EngineId | null) => {
      setLocalEngineId(id)
      if (pathname && router) {
        const next = patchSearchParams(searchParams || new URLSearchParams(), { engine: id })
        router.replace(`${pathname}${next ? `?${next}` : ''}`)
      }
    },
    [pathname, router, searchParams]
  )

  const checkSystemStatus = useCallback(
    async (id: OfflineEngine, signal: AbortSignal) => {
      setSystemStatus((prev) => ({ ...prev, [id]: undefined }))
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({ mode: `${id}-status` }),
        })
        const status = await res.json()
        if (!res.ok || status.ok === false) throw new Error(readApiErrorMessage(status, t('translate.offlineCheckFailed')))
        if (!signal.aborted) setSystemStatus((prev) => ({ ...prev, [id]: { ...status, installed: status.installed === true } }))
      } catch (error) {
        if (!signal.aborted) {
          setSystemStatus((prev) => ({ ...prev, [id]: { installed: false, status: 'error', message: error instanceof Error ? error.message : undefined } }))
        }
      }
    },
    [translationFetch, t]
  )

  const reportError = useEffectEvent((message: string) => notify.error(message))

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
        const merged = mergeEngineState(json)
        setView({ switches: merged.switches, agents: merged.agents, order: merged.order, configs: merged.configs })
        for (const id of ['apple', 'bergamot'] as const) void checkSystemStatus(id, controller.signal)
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

  async function persist(
    patch: { switches?: Partial<TranslateEngineSwitches>; order?: EngineId[]; agents?: TranslateAgentEntry[]; configs?: Partial<Record<string, TranslateEngineSettings>> },
    okMsg?: string
  ): Promise<boolean> {
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
      const merged = mergeEngineState(json)
      setView({ switches: merged.switches, agents: merged.agents, order: merged.order, configs: merged.configs })
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
    const p = agentProfiles.profiles.find((item) => item.id === entry?.profileId)
    return p?.label ?? (agentProfiles.loading ? entry?.profileId || '' : t('translate.aiProfileMissing', { id: entry?.profileId ?? '' }))
  }

  function engineSubtitle(id: EngineId): string | undefined {
    if (id === 'bing') return '公网微软翻译（可选依赖）'
    if (id === 'google') return '公网 gtx 免费翻译'
    if (id === 'apple') return 'macOS 系统原生离线神经翻译（需离线语言包）'
    if (id === 'bergamot') return '跨平台本地离线工具翻译（需安装语言包）'
    const entry = findAgentEntry(view.agents, id)
    if (!entry) return undefined
    const p = agentProfiles.profiles.find((item) => item.id === entry.profileId)
    return entry.model || p?.defaultModel || t('translate.aiModelAuto')
  }

  async function toggle(id: EngineId, checked: boolean) {
    if (loading || saving || (checked && (id === 'apple' || id === 'bergamot') && systemStatus[id]?.installed !== true)) return
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
    if (loading || saving || view.agents.length >= MAX_TRANSLATE_AGENTS || view.agents.some((a) => a.profileId === profileId)) return
    const entry: TranslateAgentEntry = {
      id: newEntryId(),
      profileId,
      model: '',
      enabled: true,
      allowConcurrency: true,
      concurrencyLimit: 4,
      maxConcurrentChars: 3000,
    }
    const name = agentProfiles.profiles.find((p) => p.id === profileId)?.label ?? profileId
    if (await persist({ agents: [...view.agents, entry] }, t('translate.agentAdded', { name }))) {
      selectEngine(agentEngineKey(entry.id))
    }
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
    if (loading || saving) {
      e.preventDefault()
      return
    }
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

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
    if (!sourceId || loading || saving || sourceId === targetId || engineGroup(sourceId) !== engineGroup(targetId)) return
    const next = view.order.filter((id) => id !== sourceId)
    const at = next.indexOf(targetId)
    if (at < 0) return
    next.splice(edge === 'after' ? at + 1 : at, 0, sourceId)
    const prev = view
    setView({ ...view, order: next })
    if (!(await persist({ order: next }))) setView(prev)
  }

  function isChecked(id: EngineId) {
    return isBuiltinEngineId(id) ? view.switches[id] : !!findAgentEntry(view.agents, id)?.enabled
  }

  // If an engine is selected, render the dedicated Detail View!
  if (selectedEngineId) {
    const activeGroup = engineGroup(selectedEngineId)
    const activeEntry = findAgentEntry(view.agents, selectedEngineId)
    const activeBuiltin = isBuiltinEngineId(selectedEngineId) ? view.configs[selectedEngineId] : undefined

    return (
      <TranslateEngineDetailView
        engineId={selectedEngineId}
        label={engineLabel(selectedEngineId)}
        subtitle={engineSubtitle(selectedEngineId)}
        group={activeGroup}
        agentEntry={activeEntry}
        builtinConfig={activeBuiltin}
        agentProfiles={agentProfiles}
        takenProfileIds={view.agents.filter((a) => agentEngineKey(a.id) !== selectedEngineId).map((a) => a.profileId)}
        systemStatus={selectedEngineId === 'apple' || selectedEngineId === 'bergamot' ? systemStatus[selectedEngineId] : undefined}
        onCheckSystemStatus={() => {
          if (selectedEngineId === 'apple' || selectedEngineId === 'bergamot') {
            const ctrl = new AbortController()
            void checkSystemStatus(selectedEngineId, ctrl.signal)
          }
        }}
        onBack={() => selectEngine(null)}
        saving={saving}
        locked={loading || saving}
        onSave={async (draft: EngineDetailDraft) => {
          if (isBuiltinEngineId(selectedEngineId)) {
            return persist(
              {
                switches: { [selectedEngineId]: draft.enabled },
                configs: {
                  [selectedEngineId]: {
                    enabled: draft.enabled,
                    allowConcurrency: draft.allowConcurrency,
                    concurrencyLimit: draft.concurrencyLimit,
                    maxConcurrentChars: draft.maxConcurrentChars,
                  },
                },
              },
              t('translate.agentSaved')
            )
          }
          if (activeEntry) {
            const updated = view.agents.map((a) =>
              a.id === activeEntry.id
                ? {
                    ...a,
                    enabled: draft.enabled,
                    allowConcurrency: draft.allowConcurrency,
                    concurrencyLimit: draft.concurrencyLimit,
                    maxConcurrentChars: draft.maxConcurrentChars,
                    profileId: draft.profileId || a.profileId,
                    model: draft.model !== undefined ? draft.model : a.model,
                  }
                : a
            )
            return persist({ agents: updated }, t('translate.agentSaved'))
          }
          return false
        }}
        onRemove={
          activeEntry
            ? async () => {
                const nextAgents = view.agents.filter((a) => a.id !== activeEntry.id)
                const ok = await persist({ agents: nextAgents }, t('translate.agentRemoved', { name: engineLabel(selectedEngineId) }))
                if (ok) selectEngine(null)
                return ok
              }
            : undefined
        }
      />
    )
  }

  // Render the 3 Cards Overview View
  return (
    <div className="flex flex-1 flex-col min-h-0 bg-paper-2 overflow-hidden" aria-label={t('translate.platformsConfig')}>
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
                          disabled={loading || saving || view.agents.length >= MAX_TRANSLATE_AGENTS}
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
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                      {ids.map((id) => {
                        const entry = findAgentEntry(view.agents, id)
                        const builtin = isBuiltinEngineId(id) ? view.configs[id] : undefined
                        const allowConcurrency = entry ? entry.allowConcurrency !== false : builtin ? builtin.allowConcurrency !== false : true
                        const limit = entry ? (entry.concurrencyLimit ?? 4) : builtin ? builtin.concurrencyLimit : 4
                        const chars = entry ? (entry.maxConcurrentChars ?? 3000) : builtin ? builtin.maxConcurrentChars : 3000

                        let badgeNode: React.ReactNode = null
                        if (id === 'bing' || id === 'google') {
                          badgeNode = (
                            <div className="flex items-center gap-1">
                              <Badge size="mini" tone="accent" dot={false}>
                                {t('translate.tagFree')}
                              </Badge>
                              <Badge size="mini" tone="neutral" dot={false}>
                                {allowConcurrency ? `并发 ${limit} · ${chars.toLocaleString()}字` : '单线程'}
                              </Badge>
                            </div>
                          )
                        } else if (id === 'apple' || id === 'bergamot') {
                          const ready = systemStatus[id]?.installed === true
                          badgeNode = (
                            <div className="flex items-center gap-1">
                              <Badge size="mini" tone={ready ? 'ok' : 'warn'} loading={systemStatus[id] === undefined}>
                                {systemStatus[id] === undefined ? t('translate.offlineChecking') : t(ready ? 'translate.tagReady' : 'translate.tagNotReady')}
                              </Badge>
                              <Badge size="mini" tone="neutral" dot={false}>
                                {allowConcurrency ? `并发 ${limit} · ${chars.toLocaleString()}字` : '单线程'}
                              </Badge>
                            </div>
                          )
                        } else {
                          badgeNode = (
                            <Badge size="mini" tone="accent" dot={false}>
                              {allowConcurrency ? `并发 ${limit} · ${chars.toLocaleString()}字` : '单线程'}
                            </Badge>
                          )
                        }

                        return (
                          <TranslateEngineRow
                            key={id}
                            label={engineLabel(id)}
                            subtitle={engineSubtitle(id)}
                            badge={badgeNode}
                            checked={isChecked(id)}
                            locked={loading || saving}
                            toggleDisabled={(id === 'apple' || id === 'bergamot') && !isChecked(id) && systemStatus[id]?.installed !== true}
                            dragging={draggingId === id}
                            dropEdge={overId === id && draggingId && draggingId !== id ? overEdge : null}
                            onToggle={(v) => void toggle(id, v)}
                            onDragStart={(e) => onDragStart(id, e)}
                            onDragEnd={clearDrag}
                            onDragOver={(e) => onDragOver(id, e)}
                            onDragLeave={() => overId === id && setOverId(null)}
                            onDrop={(e) => void onDrop(id, e)}
                            onEdit={() => selectEngine(id)}
                            actions={
                              <Button
                                size="xs"
                                variant="plain"
                                aria-label={`配置 ${engineLabel(id)}`}
                                title="配置详情"
                                className="text-ink-soft hover:text-ink flex items-center gap-1"
                                onClick={() => selectEngine(id)}
                              >
                                <IoSettingsOutline size={13} aria-hidden />
                                <span>配置</span>
                              </Button>
                            }
                          />
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="m-0 rounded-[0.35rem] border border-dashed border-line px-3 py-3 text-[0.72rem] leading-snug text-ink-soft">{t('translate.agentEmpty')}</p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
