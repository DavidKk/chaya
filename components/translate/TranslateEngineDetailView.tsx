'use client'

import { useState } from 'react'
import { IoArrowBack, IoCheckmark, IoRefreshOutline, IoTrashOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Badge, Button, NumberInput, Select, type SelectOption, SwitchToggle, TextInput } from '@/components/sk'
import { AppleOfflineGuideModal } from '@/components/translate/AppleOfflineGuideModal'
import { BergamotPackInstaller } from '@/components/translate/BergamotPackInstaller'
import type { TranslateAgentProfiles } from '@/components/translate/useTranslateAgentProfiles'
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
  onSave: (patch: EngineDetailDraft) => Promise<boolean>
  onBack: () => void
  onRemove?: () => Promise<boolean>
  saving: boolean
  locked: boolean
}

const sectionCard = 'flex flex-col rounded-lg border border-line bg-surface/30 p-5 shadow-sm'
const itemLabel = 'text-[0.8125rem] font-medium text-ink'
const itemDesc = 'text-[0.72rem] leading-relaxed text-ink-soft'

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
  onSave,
  onBack,
  onRemove,
  saving,
  locked,
}: Props) {
  const t = useT()
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
    <div className="flex flex-1 flex-col min-h-0 bg-paper-2 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        {/* Navigation & Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Button variant="plain" size="xs" onClick={onBack} aria-label="返回翻译工具列表" className="text-ink-soft hover:text-ink">
              <IoArrowBack size={16} aria-hidden />
              <span>返回翻译工具列表</span>
            </Button>
            <div className="flex items-center gap-2">
              <Badge size="mini" tone={group === 'agent' ? 'accent' : group === 'system' ? 'warn' : 'neutral'}>
                {group === 'agent' ? t('translate.groupAgent') : group === 'system' ? t('translate.groupSystem') : t('translate.groupPlatform')}
              </Badge>
              <Badge size="mini" tone={draft.enabled ? 'ok' : 'neutral'}>
                {draft.enabled ? t('translate.engineOn', { name: '' }).trim() : t('translate.engineOff', { name: '' }).trim()}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col">
            <h1 className="m-0 text-xl font-bold tracking-tight text-ink">{label}</h1>
            {subtitle ? <p className="m-0 mt-0.5 text-xs text-ink-soft">{subtitle}</p> : null}
          </div>
        </div>

        {/* Card 1: 运行与开关 */}
        <section className={sectionCard} aria-label={t('translate.engineToggle', { name: label })}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className={itemLabel}>{t('translate.engineToggle', { name: label })}</span>
              <span className={itemDesc}>开启后该工具参与翻译任务调度与回退链。</span>
            </div>
            <SwitchToggle
              checked={draft.enabled}
              disabled={locked || (group === 'system' && !draft.enabled && systemStatus?.installed !== true)}
              aria-label={t('translate.engineToggle', { name: label })}
              onCheckedChange={(enabled) => setDraft((c) => ({ ...c, enabled }))}
            />
          </div>
        </section>

        {/* Card 2: 并发与吞吐量配置 */}
        <section className={sectionCard} aria-label="并发设置">
          <div className="flex flex-col gap-5">
            {/* 是否允许并发 */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={itemLabel}>是否允许并发</span>
                <span className={itemDesc}>开启后支持多个请求并行发起翻译，大幅提升批量处理吞吐量；关闭后采用单线程顺序逐条翻译。</span>
              </div>
              <SwitchToggle
                checked={draft.allowConcurrency}
                disabled={locked}
                aria-label="是否允许并发"
                onCheckedChange={(allowConcurrency) => setDraft((c) => ({ ...c, allowConcurrency }))}
              />
            </div>

            <div className="h-px bg-line/60" />

            {/* 并发允许多少 */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={itemLabel}>并发请求数上限</span>
                <span className={itemDesc}>单次最多同时发起的最大并发请求数量（范围 1 ~ 40 个）。</span>
              </div>
              <NumberInput
                value={draft.concurrencyLimit}
                min={1}
                max={40}
                aria-label="并发请求数上限"
                disabled={locked || !draft.allowConcurrency}
                className="w-28 text-right font-mono"
                onValueChange={(concurrencyLimit) => setDraft((c) => ({ ...c, concurrencyLimit }))}
              />
            </div>

            <div className="h-px bg-line/60" />

            {/* 并发最多多少个字符 */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-4">
              <div className="flex flex-col gap-0.5">
                <span className={itemLabel}>并发最多多少个字符</span>
                <span className={itemDesc}>单批次并发请求打包的最大字符数上限（建议 500 ~ 20,000 字，默认 3,000 字）。</span>
              </div>
              <NumberInput
                value={draft.maxConcurrentChars}
                min={500}
                max={40000}
                step={500}
                aria-label="并发最多多少个字符"
                disabled={locked}
                className="w-28 text-right font-mono"
                onValueChange={(maxConcurrentChars) => setDraft((c) => ({ ...c, maxConcurrentChars }))}
              />
            </div>
          </div>
        </section>

        {/* Card 3 (Agent): 实例与模型绑定 */}
        {group === 'agent' && agentEntry ? (
          <section className={sectionCard} aria-label={t('translate.aiProfile')}>
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
          </section>
        ) : null}

        {/* Card 3 (System/Offline): 状态与离线包指引 */}
        {group === 'system' ? (
          <section className={sectionCard} aria-label="离线语言包与状态">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className={itemLabel}>离线环境状态</span>
                  <span className={itemDesc}>
                    {systemStatus?.source && systemStatus?.target
                      ? `${formatLanguageLabel(systemStatus.source)} → ${formatLanguageLabel(systemStatus.target)}`
                      : '检测当前语言对模型支持'}
                  </span>
                </div>
                <Badge size="mini" tone={systemStatus?.installed ? 'ok' : 'warn'} loading={systemStatus === undefined}>
                  {systemStatus === undefined ? t('translate.offlineChecking') : systemStatus.installed ? t('translate.tagReady') : t('translate.tagNotReady')}
                </Badge>
              </div>

              {engineId === 'bergamot' && systemStatus?.source && systemStatus?.target ? (
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
          </section>
        ) : null}

        {/* Bottom Actions Bar */}
        <div className="flex items-center justify-between gap-3 pt-2">
          {group === 'agent' && onRemove ? (
            <Button
              variant="plain"
              size="xs"
              className="text-fail hover:enabled:bg-fail/10"
              disabled={locked || saving}
              aria-label={t('translate.agentRemove')}
              onClick={() => void onRemove()}
            >
              <IoTrashOutline size={15} aria-hidden />
              <span>{t('translate.agentRemove')}</span>
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <Button variant="plain" size="xs" onClick={onBack} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" size="xs" disabled={locked || !dirty || saving} loading={saving} onClick={() => void onSave(draft)}>
              <IoCheckmark size={16} aria-hidden />
              <span>{t('common.save')}</span>
            </Button>
          </div>
        </div>
      </div>

      <AppleOfflineGuideModal open={appleGuideOpen} fromLang={systemStatus?.source || 'ja'} toLang={systemStatus?.target || 'zh'} onClose={() => setAppleGuideOpen(false)} />
    </div>
  )
}
