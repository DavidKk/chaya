'use client'

import { useState } from 'react'
import { IoRefreshOutline } from 'react-icons/io5'

import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { formCard, formDesc, formTitle, settingsCardWide } from '@/components/layoutClasses'
import { Badge, Button, NumberSliderInput, ScrollArea, Select, type SelectOption, SwitchToggle, TextInput } from '@/components/sk'
import { AppleOfflineGuideModal } from '@/components/translate/AppleOfflineGuideModal'
import { BergamotPackInstaller } from '@/components/translate/BergamotPackInstaller'
import type { TranslateAgentProfiles } from '@/components/translate/useTranslateAgentProfiles'
import { LOCALE_HTML_LANG } from '@/lib/i18n/locales'
import type { TranslateAgentEntry, TranslateEngineGroup, TranslateEngineId, TranslateEngineSettings } from '@/lib/translate/engines'
import { formatLanguageLabel } from '@/lib/translate/locales-labels'

export type EngineDetailDraft = {
  enabled: boolean
  allowConcurrency: boolean
  concurrencyLimit: number
  maxConcurrentChars: number
  profileId?: string
  model?: string
}

type Props = {
  engineId: TranslateEngineId
  label: string
  subtitle?: string
  group: TranslateEngineGroup
  agentEntry?: TranslateAgentEntry | null
  builtinConfig?: TranslateEngineSettings
  agentProfiles: TranslateAgentProfiles
  takenProfileIds?: string[]
  systemStatus?: { installed?: boolean; status?: string; message?: string; source?: string; target?: string; accessReason?: string; consoleUrl?: string }
  onCheckSystemStatus?: () => void
  onBack: () => void
  onSave: (patch: EngineDetailDraft) => Promise<boolean>
  onRemove?: () => Promise<boolean>
  saving: boolean
  locked: boolean
}

const itemLabel = formTitle
const itemDesc = formDesc

export function TranslateEngineDetailView({
  engineId,
  label,
  subtitle,
  group,
  agentEntry,
  builtinConfig,
  agentProfiles,
  takenProfileIds = [],
  systemStatus,
  onCheckSystemStatus,
  onBack,
  onSave,
  onRemove,
  saving,
  locked,
}: Props) {
  const t = useT()
  const locale = useLocaleCode()
  const numberFormat = new Intl.NumberFormat(LOCALE_HTML_LANG[locale])
  const [appleGuideOpen, setAppleGuideOpen] = useState(false)

  const initialEnabled = agentEntry ? agentEntry.enabled : Boolean(builtinConfig?.enabled)
  const initialAllowConcurrency = agentEntry
    ? agentEntry.allowConcurrency !== false
    : builtinConfig?.allowConcurrency !== undefined
      ? builtinConfig.allowConcurrency
      : group !== 'system' || engineId === 'apple'
  const initialLimit = agentEntry?.concurrencyLimit ?? builtinConfig?.concurrencyLimit ?? (engineId === 'apple' ? 40 : engineId === 'bergamot' ? 1 : 4)
  const initialChars = agentEntry?.maxConcurrentChars ?? builtinConfig?.maxConcurrentChars ?? (engineId === 'apple' ? 40000 : 3000)

  const [draft, setDraft] = useState<EngineDetailDraft>({
    enabled: initialEnabled,
    allowConcurrency: initialAllowConcurrency,
    concurrencyLimit: initialLimit,
    maxConcurrentChars: initialChars,
    profileId: agentEntry?.profileId ?? '',
    model: agentEntry?.model ?? '',
  })

  const dirty =
    draft.enabled !== initialEnabled ||
    draft.allowConcurrency !== initialAllowConcurrency ||
    draft.concurrencyLimit !== initialLimit ||
    draft.maxConcurrentChars !== initialChars ||
    (agentEntry && (draft.profileId !== agentEntry.profileId || draft.model !== agentEntry.model))

  const profile = agentProfiles.profiles.find((p) => p.id === draft.profileId)
  const profileOptions: SelectOption[] = agentProfiles.profiles.map((p) => {
    const taken = takenProfileIds.includes(p.id) && p.id !== agentEntry?.profileId
    return { value: p.id, label: taken ? `${p.label} · ${t('translate.agentAlreadyAdded')}` : p.label, disabled: taken }
  })
  if (draft.profileId && !profile) {
    profileOptions.unshift({ value: draft.profileId, label: t('translate.aiProfileMissing', { id: draft.profileId }), disabled: true })
  }

  const modelNames = (profile ? agentProfiles.models[profile.id] : undefined)?.map((m) => m.name) ?? []
  if (profile?.defaultModel && !modelNames.includes(profile.defaultModel)) modelNames.unshift(profile.defaultModel)
  if (draft.model && !modelNames.includes(draft.model)) modelNames.unshift(draft.model)
  const modelOptions: SelectOption[] = modelNames.map((name) => ({ value: name, label: name }))
  const modelValue = draft.model || profile?.defaultModel || ''

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-paper-2 overflow-hidden">
      <ScrollArea className="min-h-0 flex-1" scrollClassName="p-4">
        <div className={settingsCardWide}>
          <section className={formCard} aria-label={label}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={itemLabel}>{label}</span>
                {subtitle ? <span className={itemDesc}>{subtitle}</span> : null}
              </div>
              <SwitchToggle
                checked={draft.enabled}
                disabled={locked || (group === 'system' && !draft.enabled && systemStatus?.installed !== true)}
                aria-label={t('translate.engineToggle', { name: label })}
                onCheckedChange={(enabled) => setDraft((c) => ({ ...c, enabled }))}
              />
            </div>
            {group === 'agent' && agentEntry ? (
              <div role="group" aria-label={t('translate.aiProfile')}>
                <div className="flex flex-col gap-4">
                  <label className="flex flex-col gap-1">
                    <span className={itemLabel}>{t('translate.aiProfile')}</span>
                    <Select
                      value={draft.profileId ?? ''}
                      options={profileOptions}
                      loading={agentProfiles.loading}
                      disabled={locked}
                      emptyLabel={t('translate.aiNoProfiles') || ''}
                      aria-label={t('translate.aiProfile')}
                      onChange={(profileId) => setDraft((c) => ({ ...c, profileId, model: '' }))}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={itemLabel}>{t('translate.aiModel')}</span>
                    {modelOptions.length > 0 ? (
                      <Select
                        value={modelValue}
                        options={modelOptions}
                        placeholder={t('translate.aiModelAuto')}
                        disabled={locked || !profile}
                        aria-label={t('translate.aiModel')}
                        onChange={(model) => setDraft((c) => ({ ...c, model: model === profile?.defaultModel ? '' : model }))}
                      />
                    ) : (
                      <TextInput
                        value={draft.model || ''}
                        placeholder={profile?.defaultModel || t('translate.aiModelAuto')}
                        disabled={locked || !profile}
                        aria-label={t('translate.aiModel')}
                        onChange={(e) => setDraft((c) => ({ ...c, model: e.target.value }))}
                      />
                    )}
                  </label>
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={itemLabel}>{t('translate.allowConcurrency')}</span>
                <span className={itemDesc}>{t('translate.allowConcurrencyDesc')}</span>
              </div>
              <SwitchToggle
                checked={draft.allowConcurrency}
                disabled={locked}
                aria-label={t('translate.allowConcurrency')}
                onCheckedChange={(allowConcurrency) => setDraft((c) => ({ ...c, allowConcurrency }))}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={itemLabel}>{t('translate.concurrencyLimit')}</span>
                <span className={itemDesc}>{t('translate.concurrencyLimitDesc', { min: numberFormat.format(1), max: numberFormat.format(40) })}</span>
              </div>
              <NumberSliderInput
                value={draft.concurrencyLimit}
                min={1}
                max={40}
                aria-label={t('translate.concurrencyLimit')}
                disabled={locked || !draft.allowConcurrency}
                className="w-28 text-right font-mono"
                onValueChange={(concurrencyLimit) => setDraft((c) => ({ ...c, concurrencyLimit }))}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={itemLabel}>{t('translate.maxConcurrentChars')}</span>
                <span className={itemDesc}>{t('translate.maxConcurrentCharsDesc', { min: numberFormat.format(500), max: numberFormat.format(40000) })}</span>
              </div>
              <NumberSliderInput
                value={draft.maxConcurrentChars}
                min={500}
                max={40000}
                step={500}
                aria-label={t('translate.maxConcurrentChars')}
                disabled={locked}
                className="w-28 text-right font-mono"
                onValueChange={(maxConcurrentChars) => setDraft((c) => ({ ...c, maxConcurrentChars }))}
              />
            </div>
            {group === 'system' ? (
              <div role="group" aria-label={t('translate.offlineSettings')}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <span className={itemLabel}>{t('translate.offlineStatus')}</span>
                      <span className={itemDesc}>
                        {systemStatus?.source && systemStatus?.target
                          ? `${formatLanguageLabel(systemStatus.source)} → ${formatLanguageLabel(systemStatus.target)}`
                          : t('translate.offlinePairHint')}
                      </span>
                    </div>
                    <Badge size="mini" tone={systemStatus?.installed ? 'ok' : 'warn'} loading={systemStatus === undefined}>
                      {systemStatus === undefined ? t('translate.offlineChecking') : systemStatus.installed ? t('translate.tagReady') : t('translate.tagNotReady')}
                    </Badge>
                  </div>

                  <p className="m-0 text-xs text-ink-soft">
                    {t(
                      systemStatus === undefined
                        ? 'translate.offlineChecking'
                        : systemStatus.installed
                          ? 'translate.offlineReadyHint'
                          : systemStatus.status === 'supported'
                            ? 'translate.appleOfflinePackMissing'
                            : systemStatus.status === 'unsupported'
                              ? 'translate.offlineUnsupportedPair'
                              : systemStatus.status === 'model_pack_missing'
                                ? 'translate.bergamotPackMissing'
                                : engineId === 'bergamot' && systemStatus.status === 'unavailable'
                                  ? 'translate.bergamotUnavailable'
                                  : 'translate.offlineCheckFailed'
                    )}
                  </p>
                  {engineId === 'bergamot' && systemStatus?.accessReason === 'management_required' ? (
                    <p className="m-0 text-xs text-ink-soft">
                      {systemStatus.consoleUrl ? (
                        <a href={systemStatus.consoleUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                          {t('translate.packConsoleRequired')}
                        </a>
                      ) : (
                        t('translate.packConsoleRequired')
                      )}
                    </p>
                  ) : engineId === 'bergamot' && systemStatus?.source && systemStatus?.target ? (
                    <BergamotPackInstaller source={systemStatus.source} target={systemStatus.target} onInstalled={() => onCheckSystemStatus?.()} />
                  ) : null}

                  {systemStatus?.message ? <p className="m-0 break-words text-xs text-ink-soft">{systemStatus.message}</p> : null}

                  <div className="flex items-center gap-2 pt-2">
                    {engineId === 'apple' && systemStatus?.status === 'supported' ? (
                      <Button size="xs" onClick={() => setAppleGuideOpen(true)}>
                        {t('translate.offlineGuide')}
                      </Button>
                    ) : null}
                    <Button size="xs" variant="plain" onClick={onCheckSystemStatus} disabled={locked || systemStatus === undefined}>
                      <IoRefreshOutline size={14} aria-hidden />
                      <span>{t('translate.offlineRecheck')}</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div role="toolbar" aria-label={label} className="flex flex-wrap items-center gap-2">
              <Button disabled={saving} aria-label={t('translate.backToEngines')} onClick={onBack}>
                {t('legal.back')}
              </Button>
              {group === 'agent' && onRemove ? (
                <Button className="text-fail hover:enabled:bg-fail/10" disabled={locked || saving} aria-label={t('translate.agentRemove')} onClick={() => void onRemove()}>
                  {t('integration.agentDelete')}
                </Button>
              ) : null}
              <Button className="ml-auto" variant="accent" aria-label={t('common.save')} disabled={locked || !dirty || saving} loading={saving} onClick={() => void onSave(draft)}>
                {t('common.save')}
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>

      <AppleOfflineGuideModal open={appleGuideOpen} fromLang={systemStatus?.source || 'ja'} toLang={systemStatus?.target || 'zh'} onClose={() => setAppleGuideOpen(false)} />
    </div>
  )
}
