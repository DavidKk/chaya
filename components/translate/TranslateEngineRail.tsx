'use client'

import { Menu } from '@base-ui/react/menu'
import Link from 'next/link'
import { type DragEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { IoAdd, IoCloseOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button, ScrollArea, Tooltip } from '@/components/sk'
import { dropdownItemClass, dropdownPopupClass, dropdownTriggerClass } from '@/components/sk/dropdownMenu'
import { TranslateAgentEntryConfig } from '@/components/translate/TranslateAgentEntryConfig'
import { TranslateEngineRow } from '@/components/translate/TranslateEngineRow'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { useTranslateAgentProfiles } from '@/components/translate/useTranslateAgentProfiles'
import { readApiErrorMessage } from '@/lib/api-error'
import type { MessageKey } from '@/lib/i18n'
import {
  agentEngineKey,
  DEFAULT_ENGINE_ORDER,
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
import { cn } from '@/lib/utils'

export type EngineId = TranslateEngineId

export type EngineSwitches = TranslateEngineSwitches

const BUILTIN_LABEL_KEY: Record<TranslateBuiltinId, MessageKey> = {
  bing: 'translate.engineBing',
  google: 'translate.engineGoogle',
}

const GROUPS: Array<{ id: TranslateEngineGroup; labelKey: MessageKey; descKey: MessageKey }> = [
  { id: 'agent', labelKey: 'translate.groupAgent', descKey: 'translate.groupAgentDesc' },
  { id: 'platform', labelKey: 'translate.groupPlatform', descKey: 'translate.groupPlatformDesc' },
]

const groupLabel = 'text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft uppercase'

type EngineView = Omit<TranslateEngineState, 'enabled'>

const INITIAL: EngineView = { switches: DEFAULT_ENGINE_SWITCHES, agents: [], order: DEFAULT_ENGINE_ORDER }

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
  className?: string
  onChange?: (switches: EngineSwitches, enabled: EngineId[]) => void
  /** 小屏抽屉是否打开（由父级控制） */
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
  /** 控制台里的 Agent 管理页；局内浮层不传 */
  manageAgentsHref?: string
}

/** 翻译页左侧：Agent 组（用户添加的 Agent 实例）与翻译平台组；组内拖拽排序，先试 Agent 再试平台 */
export function TranslateEngineRail({ disabled, className, onChange, mobileOpen = false, onMobileOpenChange, manageAgentsHref }: Props) {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const agentProfiles = useTranslateAgentProfiles()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<EngineView>(INITIAL)
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
    const enabled = enabledOf(next)
    if (sameIds(enabledRef.current, enabled)) return
    enabledRef.current = enabled
    onChange?.(next.switches, enabled)
  }
  const publishEvent = useEffectEvent(publish)
  const reportError = useEffectEvent((message: string) => notify.error(message))

  function viewFrom(json: Partial<EngineView>, fallback: EngineView): EngineView {
    return { switches: json.switches ?? fallback.switches, agents: json.agents ?? fallback.agents, order: json.order?.length ? json.order : fallback.order }
  }

  useEffect(() => {
    let cancelled = false
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
        publishEvent(next)
      } catch (err) {
        if (!cancelled) reportError(err instanceof Error ? err.message : t('translate.enginesLoadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t, translationFetch])

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
    if (locked) return
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
    return (
      <TranslateEngineRow
        key={id}
        label={engineLabel(id)}
        subtitle={engineSubtitle(id)}
        checked={isChecked(id)}
        locked={locked}
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
      >
        {entry && open ? (
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
                          className={cn(dropdownTriggerClass, 'size-7 justify-center p-0 disabled:cursor-not-allowed disabled:opacity-50')}
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
    </>
  )
}
