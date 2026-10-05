'use client'

import { type DragEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { IoCloseOutline } from 'react-icons/io5'
import { LuGripVertical } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { formTitle } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { Button, ScrollArea, SwitchToggle, TruncateText } from '@/components/sk'
import { useTranslationFetch } from '@/components/translate/TranslationRuntimeContext'
import { readApiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'

export type EngineId = 'ollama' | 'bing' | 'google'

export type EngineSwitches = Record<EngineId, boolean>

const ENGINE_LABEL: Record<EngineId, string> = {
  ollama: 'Ollama',
  bing: 'Bing',
  google: 'Google',
}

const DEFAULT_ORDER: EngineId[] = ['ollama', 'bing', 'google']
const DEFAULT_SWITCHES: EngineSwitches = { ollama: true, bing: true, google: true }

function sameIds(a: EngineId[], b: EngineId[]) {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function enabledFrom(order: EngineId[], switches: EngineSwitches): EngineId[] {
  return order.filter((id) => switches[id])
}

type Props = {
  disabled?: boolean
  className?: string
  onChange?: (switches: EngineSwitches, enabled: EngineId[]) => void
  /** 小屏抽屉是否打开（由父级控制） */
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
}

/** 翻译页左侧：开关 + 拖拽排序补译优先级；小屏为滑出抽屉，不占主栏宽度 */
export function TranslateEngineRail({ disabled, className, onChange, mobileOpen = false, onMobileOpenChange }: Props) {
  const t = useT()
  const translationFetch = useTranslationFetch()
  const notify = useNotification()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [switches, setSwitches] = useState<EngineSwitches>(DEFAULT_SWITCHES)
  const [order, setOrder] = useState<EngineId[]>(DEFAULT_ORDER)
  const [draggingId, setDraggingId] = useState<EngineId | null>(null)
  const [overId, setOverId] = useState<EngineId | null>(null)
  const [overEdge, setOverEdge] = useState<'before' | 'after'>('before')
  const enabledRef = useRef<EngineId[]>(DEFAULT_ORDER)
  const dragGhostRef = useRef<HTMLElement | null>(null)

  function closeMobile() {
    onMobileOpenChange?.(false)
  }

  const emitChange = useEffectEvent((nextSwitches: EngineSwitches, nextOrder: EngineId[]) => {
    const enabled = enabledFrom(nextOrder, nextSwitches)
    if (sameIds(enabledRef.current, enabled)) return
    enabledRef.current = enabled
    onChange?.(nextSwitches, enabled)
  })

  function publishEnabled(nextSwitches: EngineSwitches, nextOrder: EngineId[]) {
    const enabled = enabledFrom(nextOrder, nextSwitches)
    if (sameIds(enabledRef.current, enabled)) return
    enabledRef.current = enabled
    onChange?.(nextSwitches, enabled)
  }

  const reportError = useEffectEvent((message: string) => {
    notify.error(message)
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await translationFetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'switches' }),
        })
        const json = (await res.json()) as {
          ok?: boolean
          switches?: EngineSwitches
          order?: EngineId[]
          enabled?: EngineId[]
          file?: string
          error?: unknown
        }
        if (cancelled) return
        if (!res.ok || json.ok === false) {
          reportError(readApiErrorMessage(json, t('translate.enginesLoadFailed')))
          return
        }
        const nextSwitches = json.switches ?? DEFAULT_SWITCHES
        const nextOrder = json.order?.length ? json.order : DEFAULT_ORDER
        setSwitches(nextSwitches)
        setOrder(nextOrder)
        emitChange(nextSwitches, nextOrder)
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

  async function persist(patch: { switches?: Partial<EngineSwitches>; order?: EngineId[] }, okMsg?: string) {
    setSaving(true)
    try {
      const res = await translationFetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'switches', ...patch }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        switches?: EngineSwitches
        order?: EngineId[]
        file?: string
        error?: unknown
      }
      if (!res.ok || json.ok === false) {
        notify.error(readApiErrorMessage(json, t('translate.enginesSaveFailed')))
        return false
      }
      const nextSwitches = json.switches ?? switches
      const nextOrder = json.order?.length ? json.order : order
      setSwitches(nextSwitches)
      setOrder(nextOrder)
      publishEnabled(nextSwitches, nextOrder)
      if (okMsg) notify.success(okMsg)
      return true
    } catch (err) {
      notify.error(err instanceof Error ? err.message : t('translate.enginesSaveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function toggle(id: EngineId, checked: boolean) {
    if (saving || disabled) return
    const draft = { ...switches, [id]: checked }
    if (!DEFAULT_ORDER.some((key) => draft[key])) {
      notify.warning(t('translate.needOneEngine'))
      return
    }
    await persist({ switches: { [id]: checked } }, t(checked ? 'translate.engineOn' : 'translate.engineOff', { name: ENGINE_LABEL[id] }))
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
    if (saving || disabled || loading) {
      e.preventDefault()
      return
    }
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)

    const row = e.currentTarget.closest('li')
    if (row) {
      const ghost = row.cloneNode(true) as HTMLElement
      ghost.style.position = 'fixed'
      ghost.style.top = '-9999px'
      ghost.style.left = '-9999px'
      ghost.style.width = `${row.getBoundingClientRect().width}px`
      ghost.style.opacity = '0.92'
      ghost.style.pointerEvents = 'none'
      ghost.style.boxShadow = '0 10px 28px rgb(0 0 0 / 0.45)'
      ghost.style.transform = 'rotate(1.5deg) scale(1.02)'
      ghost.style.borderRadius = '0.35rem'
      document.body.appendChild(ghost)
      dragGhostRef.current = ghost
      e.dataTransfer.setDragImage(ghost, 16, 20)
    }
  }

  function onDragOver(id: EngineId, e: DragEvent<HTMLLIElement>) {
    if (!draggingId || draggingId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    setOverId(id)
    setOverEdge(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
  }

  function onDragLeave(id: EngineId) {
    if (overId === id) setOverId(null)
  }

  async function onDrop(targetId: EngineId, e: DragEvent<HTMLLIElement>) {
    e.preventDefault()
    const sourceId = (e.dataTransfer.getData('text/plain') as EngineId) || draggingId
    const edge = overEdge
    clearDrag()
    if (!sourceId || saving || disabled) return
    const from = order.indexOf(sourceId)
    let to = order.indexOf(targetId)
    if (from < 0 || to < 0) return
    if (sourceId === targetId) return
    if (edge === 'after') to += 1
    const next = [...order]
    next.splice(from, 1)
    const insertAt = from < to ? to - 1 : to
    next.splice(insertAt, 0, sourceId)
    if (sameIds(next, order)) return
    const prev = order
    setOrder(next)
    const ok = await persist({ order: next })
    if (!ok) setOrder(prev)
  }

  function onDragEnd() {
    clearDrag()
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
          'flex w-[18.5rem] flex-col min-h-0 border-r border-line bg-paper-2',
          'md:relative md:shrink-0 md:translate-x-0',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[70] max-md:h-dvh max-md:shadow-[8px_0_28px_rgb(0_0_0/0.4)]',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:-translate-x-full',
          className
        )}
        aria-label={t('translate.platformsConfig')}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
          <h2 className={cn(formTitle, 'm-0 text-[0.8125rem]')}>{loading ? t('common.loading') : t('translate.enginesTitle')}</h2>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('translate.enginesClose')} tooltip={t('common.close')} onClick={() => closeMobile()}>
            <IoCloseOutline size={16} aria-hidden />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1" indicator="vertical" reserveGutter={false} scrollProps={{ 'aria-label': t('translate.enginesList') }}>
          <ul className="m-0 flex list-none flex-col gap-2 p-4">
            {order.map((id) => {
              const label = ENGINE_LABEL[id]
              const showLine = overId === id && draggingId && draggingId !== id
              return (
                <li
                  key={id}
                  onDragOver={(e) => onDragOver(id, e)}
                  onDragLeave={() => onDragLeave(id)}
                  onDrop={(e) => void onDrop(id, e)}
                  className={cn(
                    'relative grid h-11 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-1 rounded-[0.35rem] border border-line bg-panel pr-3 pl-0 transition-[opacity,transform,box-shadow,border-color] duration-150 ease-out',
                    draggingId === id && 'scale-[0.985] opacity-40 shadow-none',
                    !draggingId && 'hover:border-[color-mix(in_oklab,var(--line)_70%,var(--accent))]'
                  )}
                >
                  {showLine && overEdge === 'before' ? (
                    <span className="pointer-events-none absolute inset-x-1 -top-1 h-0.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />
                  ) : null}
                  {showLine && overEdge === 'after' ? (
                    <span className="pointer-events-none absolute inset-x-1 -bottom-1 h-0.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />
                  ) : null}
                  <button
                    type="button"
                    draggable={!loading && !saving && !disabled}
                    disabled={loading || saving || disabled}
                    aria-label={t('translate.dragEngine', { name: label })}
                    title={t('translate.dragOrder')}
                    className={cn(
                      'inline-flex h-full w-full cursor-grab appearance-none items-center justify-center border-none bg-transparent p-0 text-ink-soft/70',
                      'hover:enabled:text-ink active:cursor-grabbing',
                      'disabled:cursor-not-allowed disabled:opacity-40'
                    )}
                    onDragStart={(e) => onDragStart(id, e)}
                    onDragEnd={onDragEnd}
                  >
                    <LuGripVertical size={12} aria-hidden />
                  </button>
                  <div className="flex min-w-0 items-center">
                    <TruncateText text={label} className="text-[0.8125rem] font-medium leading-none text-ink" />
                  </div>
                  <div className="flex h-full items-center justify-center">
                    <SwitchToggle
                      checked={!!switches[id]}
                      disabled={loading || saving || disabled}
                      aria-label={t('translate.engineToggle', { name: label })}
                      onCheckedChange={(v) => void toggle(id, v)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </aside>
    </>
  )
}
