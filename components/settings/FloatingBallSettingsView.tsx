'use client'

import { LuArrowDown, LuArrowUp, LuRotateCcw, LuX } from 'react-icons/lu'

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
  const shortcuts = settings.floatingBallShortcuts
  const disabled = busy || unavailable
  const available = FLOATING_SHORTCUT_TARGETS.filter((target) => !shortcuts.includes(target.id as FloatingShortcutId))

  function move(id: FloatingShortcutId, offset: number) {
    void update((current) => {
      const next = [...current.floatingBallShortcuts]
      const index = next.indexOf(id)
      const other = index + offset
      if (index >= 0 && other >= 0 && other < next.length) [next[index], next[other]] = [next[other]!, next[index]!]
      return { floatingBallShortcuts: next }
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
                    {shortcuts.map((id, index) => {
                      const target = FLOATING_SHORTCUT_LABELS.get(id)!
                      const name = t(target.labelKey)
                      return (
                        <li key={id} className="flex items-center gap-2 rounded-lg border border-line bg-panel p-3">
                          <span aria-hidden className="w-4 shrink-0 text-xs tabular-nums text-ink-soft">
                            {index + 1}
                          </span>
                          <div className="grid min-w-0 flex-1 gap-1">
                            <span className="text-sm font-medium text-ink">{name}</span>
                            <span className="text-xs text-ink-soft">{t(target.descKey)}</span>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button size="icon" variant="plain" aria-label={t('floatingBall.moveUp', { name })} disabled={disabled || index === 0} onClick={() => move(id, -1)}>
                              <LuArrowUp size={15} />
                            </Button>
                            <Button
                              size="icon"
                              variant="plain"
                              aria-label={t('floatingBall.moveDown', { name })}
                              disabled={disabled || index === shortcuts.length - 1}
                              onClick={() => move(id, 1)}
                            >
                              <LuArrowDown size={15} />
                            </Button>
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
