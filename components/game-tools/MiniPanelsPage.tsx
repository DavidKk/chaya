'use client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { SaveCard, settingsRow, settingsRows } from '@/components/game-saves/SaveCard'
import { useT } from '@/components/i18n/LocaleProvider'
import { formControlInline, formDescInline, formTitleInline, panelHead } from '@/components/layoutClasses'
import { useNotification } from '@/components/notification/useNotification'
import { ScrollArea, Select, Skeleton, SkeletonRegion } from '@/components/sk'
import { SwitchToggle } from '@/components/sk/Switch'
import { PANEL_DOCK_ITEMS, type PanelDockItem, readCachedToolSettings } from '@/lib/game-agent/tool-settings'

import { PANEL_DOCK_ITEM_META } from './mini-panel-items'
import { useToolSettings } from './useToolSettings'

function PageSkeleton({ label }: { label: string }) {
  return (
    <SkeletonRegion label={label} className="flex flex-col gap-4">
      {[2, 5].map((rows) => (
        <div key={rows} className="flex flex-col gap-3 rounded-md border border-line bg-panel p-4">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </SkeletonRegion>
  )
}

/** 辅助 › 迷你面板：迷你面板管理的开关、方向与按钮项；Web 与局内浮层共用 */
export function MiniPanelsPage({ request }: { request?: GameAgentRequest }) {
  const t = useT()
  const notify = useNotification()
  const { settings, loaded, error, unavailable, update } = useToolSettings(request)
  const locked = unavailable
  const hidden = settings.panelDockHiddenItems
  const allShown = hidden.length === 0 ? true : hidden.length === PANEL_DOCK_ITEMS.length ? false : 'mixed'

  const setHidden = (next: readonly PanelDockItem[]) => void update({ panelDockHiddenItems: [...next] })
  const toggleItem = (item: PanelDockItem, show: boolean) =>
    void update(({ panelDockHiddenItems: current }) => ({ panelDockHiddenItems: show ? current.filter((i) => i !== item) : [...current, item] }))
  const toggleDock = (next: boolean) =>
    void update({ panelDockEnabled: next }).then(() => {
      if (readCachedToolSettings().panelDockEnabled === next) notify.success(t(next ? 'panels.dock.enabled' : 'panels.dock.disabled'))
    })

  const body = !loaded ? (
    <PageSkeleton label={t('nav.miniPanels')} />
  ) : (
    <>
      <SaveCard
        id="mini-panel-dock"
        title={t('panels.dock.title')}
        description={unavailable ? t('panels.dock.unavailable') : t('panels.dock.desc')}
        action={
          <SwitchToggle
            checked={settings.panelDockEnabled}
            aria-label={t('panels.dock.enable')}
            tooltip={t(settings.panelDockEnabled ? 'panels.dock.disable' : 'panels.dock.enable')}
            disabled={locked}
            onCheckedChange={toggleDock}
          />
        }
      >
        <div className={settingsRows}>
          <div className={settingsRow}>
            <span className={formTitleInline}>{t('panels.dock.orientation')}</span>
            <span className={formDescInline}>{t('panels.dock.orientationDesc')}</span>
            <div className={formControlInline}>
              <Select
                className="w-32"
                value={settings.panelDockOrientation}
                options={[
                  { value: 'horizontal', label: t('panels.dock.horizontal') },
                  { value: 'vertical', label: t('panels.dock.vertical') },
                ]}
                disabled={locked}
                aria-label={t('panels.dock.orientation')}
                onChange={(value) => void update({ panelDockOrientation: value === 'vertical' ? 'vertical' : 'horizontal' })}
              />
            </div>
          </div>
        </div>
      </SaveCard>
      <SaveCard
        id="mini-panel-dock-items"
        title={t('panels.items.title')}
        description={t('panels.items.desc')}
        action={
          <SwitchToggle
            checked={allShown}
            aria-label={t(allShown === true ? 'panels.items.hideAll' : 'panels.items.showAll')}
            tooltip={t(allShown === true ? 'panels.items.hideAll' : 'panels.items.showAll')}
            disabled={locked}
            onCheckedChange={(next) => setHidden(next ? [] : PANEL_DOCK_ITEMS)}
          />
        }
      >
        <ul className="m-0 list-none divide-y divide-line p-0" aria-label={t('panels.items.listAria')}>
          {PANEL_DOCK_ITEMS.map((item) => {
            const { icon: Icon, labelKey, descKey } = PANEL_DOCK_ITEM_META[item]
            const name = t(labelKey)
            const shown = !hidden.includes(item)
            return (
              <li key={item} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-panel-2 text-ink-soft" aria-hidden>
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[0.8125rem] font-medium text-ink">{name}</p>
                  <p className="m-0 text-[0.7rem] leading-[1.35] text-ink-soft">{t(descKey)}</p>
                </div>
                <SwitchToggle checked={shown} aria-label={t('panels.items.toggle', { name })} disabled={locked} onCheckedChange={(next) => toggleItem(item, next)} />
              </li>
            )
          })}
        </ul>
        {error && !unavailable ? (
          <p role="alert" className="m-0 border-t border-line px-4 py-2 text-xs text-fail">
            {error}
          </p>
        ) : null}
      </SaveCard>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 text-sm font-semibold text-ink">{t('nav.miniPanels')}</h1>
          <p className="m-0 truncate text-xs text-ink-soft">{t('panels.subtitle')}</p>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('nav.miniPanels') }}>
        <div className="flex w-full max-w-3xl flex-col gap-4 p-4">{body}</div>
      </ScrollArea>
    </div>
  )
}
