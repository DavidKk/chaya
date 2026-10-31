'use client'

import { type DragEvent, useState } from 'react'
import { LuGripVertical, LuRotateCcw, LuX } from 'react-icons/lu'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { FLOATING_SHORTCUT_LABELS, FLOATING_SHORTCUT_TARGETS } from '@/components/game-tools/floating-shortcuts'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, settingsCardNarrow } from '@/components/layoutClasses'
import { Button, ScrollArea, Select, Skeleton, Switch } from '@/components/sk'
import { DEFAULT_FLOATING_SHORTCUTS, type FloatingShortcutId, MAX_FLOATING_SHORTCUTS, normalizeFloatingShortcuts, parseFloatingShortcut } from '@/lib/game-agent/floating-ball'

export function FloatingBallSettingsView({ request }: { request: GameAgentRequest }) {
  const t = useT()
  const { settings, loaded, busy, unavailable, error, update } = useToolSettings(request)
  const [draggingId, setDraggingId] = useState<FloatingShortcutId | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: FloatingShortcutId; edge: 'before' | 'after' } | null>(null)
  const shortcuts = settings.floatingBallShortcuts
  const disabled = busy || unavailable
  const available = FLOATING_SHORTCUT_TARGETS.filter((target) => !shortcuts.includes(target.id as FloatingShortcutId))

  function move(id: FloatingShortcutId, offset: number) {
    if (disabled) return
    const index = shortcuts.indexOf(id)
    if (index < 0 || index + offset < 0 || index + offset >= shortcuts.length) return
    void update((current) => {
      const next = [...current.floatingBallShortcuts]
      const index = next.indexOf(id)
      const other = index + offset
      if (index >= 0 && other >= 0 && other < next.length) [next[index], next[other]] = [next[other]!, next[index]!]
      return { floatingBallShortcuts: next }
    })
  }

  function clearDrag() {
    setDraggingId(null)
    setDropTarget(null)
  }

  function onDragStart(id: FloatingShortcutId, event: DragEvent<HTMLButtonElement>) {
    if (disabled) {
      event.preventDefault()
      return
    }
    setDraggingId(id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    const row = event.currentTarget.closest('li')
    if (row) event.dataTransfer.setDragImage(row, 16, row.getBoundingClientRect().height / 2)
  }

  function onDragOver(id: FloatingShortcutId, event: DragEvent<HTMLLIElement>) {
    if (disabled || !draggingId || draggingId === id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const rect = event.currentTarget.getBoundingClientRect()
    setDropTarget({ id, edge: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
  }

  function onDrop(id: FloatingShortcutId, event: DragEvent<HTMLLIElement>) {
    event.preventDefault()
    const source = draggingId
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY >= rect.top + rect.height / 2
    clearDrag()
    if (disabled || !source || source === id || event.dataTransfer.getData('text/plain') !== source) return
    const next = shortcuts.filter((item) => item !== source)
    const index = next.indexOf(id)
    if (index < 0) return
    next.splice(index + (after ? 1 : 0), 0, source)
    if (next.every((item, at) => item === shortcuts[at])) return
    void update((current) => {
      const order = current.floatingBallShortcuts.filter((item) => item !== source)
      const at = order.indexOf(id)
      if (at < 0 || !current.floatingBallShortcuts.includes(source)) return {}
      order.splice(at + (after ? 1 : 0), 0, source)
      return { floatingBallShortcuts: order }
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className="flex min-h-[3.25rem] shrink-0 items-center border-b border-line px-4 py-2">
        <div className="grid min-w-0 gap-1">
          <h2 className="m-0 text-sm font-semibold text-ink">{t('floatingBall.title')}</h2>
          <p className="m-0 text-xs text-ink-soft">{t('floatingBall.description')}</p>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" scrollClassName="p-4">
        <div className={settingsCardNarrow}>
          {!loaded ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <>
              <section className={formCard}>
                <Switch
                  checked={settings.floatingBallEnabled}
                  label={t('floatingBall.title')}
                  description={unavailable ? t('tools.unavailable') : t('floatingBall.drag')}
                  disabled={disabled}
                  toggleTooltip={t(settings.floatingBallEnabled ? 'tools.turnOff' : 'tools.turnOn', { name: t('floatingBall.title') })}
                  onCheckedChange={(floatingBallEnabled) => void update({ floatingBallEnabled })}
                />
              </section>
              <section className={formCard} aria-label={t('floatingBall.bindings')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-sm font-medium text-ink">{t('floatingBall.bindings')}</h3>
                  <Button variant="ghost" disabled={disabled} onClick={() => void update({ floatingBallShortcuts: [...DEFAULT_FLOATING_SHORTCUTS] })}>
                    <LuRotateCcw size={14} />
                    {t('floatingBall.reset')}
                  </Button>
                </div>
                <Select
                  aria-label={t('floatingBall.add')}
                  placeholder={t('floatingBall.add')}
                  value=""
                  disabled={disabled || shortcuts.length >= MAX_FLOATING_SHORTCUTS}
                  options={available.map((target, index) => ({
                    value: target.id,
                    label: t(target.labelKey),
                    group: available[index - 1]?.groupKey !== target.groupKey ? t(target.groupKey) : undefined,
                    divider: index > 0 && available[index - 1]?.groupKey !== target.groupKey,
                  }))}
                  onChange={(id) => {
                    if (!parseFloatingShortcut(id)) return
                    void update((current) => ({ floatingBallShortcuts: normalizeFloatingShortcuts([...current.floatingBallShortcuts, id]) }))
                  }}
                />
                <p className="m-0 text-xs text-ink-soft">{t('floatingBall.limit', { count: MAX_FLOATING_SHORTCUTS })}</p>
                {shortcuts.length ? (
                  <ol className="m-0 grid list-none gap-2 p-0">
                    {shortcuts.map((id) => {
                      const target = FLOATING_SHORTCUT_LABELS.get(id)!
                      const name = t(target.labelKey)
                      return (
                        <li
                          key={id}
                          onDragOver={(event) => onDragOver(id, event)}
                          onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => (current?.id === id ? null : current))
                          }}
                          onDrop={(event) => onDrop(id, event)}
                          className={`relative flex items-center gap-2 rounded-lg border border-line bg-panel py-3 pr-3 transition-[opacity,transform,border-color] duration-150 ease-out ${draggingId === id ? 'scale-[0.985] opacity-40' : ''}`}
                        >
                          {dropTarget?.id === id ? (
                            <span
                              className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)] ${dropTarget.edge === 'before' ? '-top-1' : '-bottom-1'}`}
                            />
                          ) : null}
                          <Button
                            size="icon"
                            variant="plain"
                            className="w-5 shrink-0 cursor-grab self-stretch text-ink-soft active:cursor-grabbing aria-disabled:cursor-default aria-disabled:opacity-50"
                            aria-label={t('floatingBall.reorder', { name })}
                            draggable={!disabled}
                            disabled={unavailable}
                            aria-disabled={disabled}
                            tooltipSuppressed={draggingId !== null}
                            onDragStart={(event) => onDragStart(id, event)}
                            onDragEnd={clearDrag}
                            onKeyDown={(event) => {
                              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                              event.preventDefault()
                              move(id, event.key === 'ArrowUp' ? -1 : 1)
                            }}
                          >
                            <LuGripVertical size={12} aria-hidden />
                          </Button>
                          <div className="grid min-w-0 flex-1 gap-1">
                            <span className="text-sm font-medium text-ink">{name}</span>
                            <span className="text-xs text-ink-soft">{t(target.descKey)}</span>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              size="icon"
                              variant="plain"
                              aria-label={t('floatingBall.remove', { name })}
                              disabled={disabled}
                              onClick={() => void update((current) => ({ floatingBallShortcuts: current.floatingBallShortcuts.filter((item) => item !== id) }))}
                            >
                              <LuX size={15} />
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <p className="m-0 text-sm text-ink-soft">{t('floatingBall.empty')}</p>
                )}
              </section>
            </>
          )}
          {error && !unavailable ? (
            <p role="alert" className="m-0 text-xs text-fail">
              {error}
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
