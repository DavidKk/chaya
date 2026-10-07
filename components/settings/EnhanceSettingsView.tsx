'use client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useT } from '@/components/i18n/LocaleProvider'
import { formCard, panelHead, settingsCardNarrow } from '@/components/layoutClasses'
import { Skeleton, SkeletonRegion, Switch } from '@/components/sk'

/** 辅助 › 能力增强：改进游戏原有操作的开关，存在工具设置里，游戏插件同步后生效 */
export function EnhanceSettingsView({ request }: { request: GameAgentRequest }) {
  const t = useT()
  const { settings, busy, loaded, error, update } = useToolSettings(request)
  const title = t('nav.enhance')
  const label = t('edit.flagSmartPath')
  const enabled = settings.smartPathEnabled

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-sm font-semibold text-ink">{title}</h2>
          <p className="m-0 truncate text-xs text-ink-soft">{t('edit.enhancePage')}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={settingsCardNarrow}>
          {!loaded ? (
            <SkeletonRegion label={title} className={formCard}>
              <div className="flex items-center justify-between gap-4">
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            </SkeletonRegion>
          ) : (
            <section className={formCard}>
              <Switch
                checked={enabled}
                label={label}
                description={t('edit.flagSmartPathDesc')}
                disabled={busy}
                toggleTooltip={enabled ? t('edit.toggleOff', { name: label }) : t('edit.toggleOn', { name: label })}
                onCheckedChange={(next) => void update({ smartPathEnabled: next })}
              />
              {error ? (
                <p role="alert" className="text-xs text-fail">
                  {error}
                </p>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
