'use client'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { formCard, panelHead, settingsCardNarrow } from '@/components/layoutClasses'
import { Select, Skeleton, SkeletonRegion, Switch } from '@/components/sk'
import { COMPANION_CHARACTERS, type CompanionCharacter, companionWords } from '@/lib/game-agent/companion'

export type ToolPage = 'minimap' | 'companion'

function ToolSettingsSkeleton({ label, withSelect }: { label: string; withSelect: boolean }) {
  return (
    <SkeletonRegion label={label} className={formCard}>
      <div className="flex items-center justify-between gap-4">
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      {withSelect ? (
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-8 w-48 max-w-[60%]" />
        </div>
      ) : null}
    </SkeletonRegion>
  )
}

export function ToolSettingsView({ page, request }: { page: ToolPage; request: GameAgentRequest }) {
  const t = useT()
  const locale = useLocaleCode()
  const { settings, busy, loaded, error, unavailable, update } = useToolSettings(request)
  const isMap = page === 'minimap'
  const title = isMap ? t('nav.minimap') : t('nav.companion')
  const enabled = isMap ? settings.miniMapEnabled : settings.companionEnabled

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2">
      <div className={panelHead}>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-sm font-semibold text-ink">{title}</h2>
          <p className="m-0 truncate text-xs text-ink-soft">{isMap ? t('tools.minimapPage') : t('tools.companionPage')}</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className={settingsCardNarrow}>
          {!loaded ? (
            <ToolSettingsSkeleton label={title} withSelect={!isMap} />
          ) : (
            <section className={formCard}>
              <Switch
                checked={enabled}
                label={title}
                description={unavailable ? t('tools.unavailable') : isMap ? t('tools.minimapDesc') : t('tools.companionDesc')}
                disabled={busy || unavailable}
                toggleTooltip={t(enabled ? 'tools.turnOff' : 'tools.turnOn', { name: title })}
                onCheckedChange={(next) => void update(isMap ? { miniMapEnabled: next } : { companionEnabled: next })}
              />
              {!isMap ? (
                <div className="flex min-w-0 items-center justify-between gap-4">
                  <label htmlFor="companion-character" className="text-sm font-medium text-ink">
                    {t('tools.character')}
                  </label>
                  <Select
                    id="companion-character"
                    className="w-48 max-w-[60%]"
                    value={settings.companionCharacter}
                    options={COMPANION_CHARACTERS.map((character) => ({ value: character, label: companionWords(locale).names[character] }))}
                    disabled={busy || unavailable || !enabled}
                    onChange={(character) => void update({ companionCharacter: character as CompanionCharacter })}
                  />
                </div>
              ) : null}
              {error && !unavailable ? (
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
