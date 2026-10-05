'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Select, type SelectOption, TextAction } from '@/components/sk'
import type { TranslateAgentProfiles } from '@/components/translate/useTranslateAgentProfiles'
import type { TranslateAgentEntry } from '@/lib/translate/engines'

type Props = {
  entry: TranslateAgentEntry
  agents: TranslateAgentProfiles
  /** 其它条目已用的实例；同一实例只能添加一次 */
  takenProfileIds?: string[]
  disabled?: boolean
  onChange: (patch: Partial<Pick<TranslateAgentEntry, 'profileId' | 'model'>>) => void
  onRemove: () => void
}

const fieldLabel = 'text-[0.72rem] font-medium text-ink-soft'

/** 一条 Agent 翻译条目：换实例、选模型、移除 */
export function TranslateAgentEntryConfig({ entry, agents, takenProfileIds = [], disabled, onChange, onRemove }: Props) {
  const t = useT()
  const profile = agents.profiles.find((p) => p.id === entry.profileId)
  const profileOptions: SelectOption[] = agents.profiles.map((p) => {
    const taken = takenProfileIds.includes(p.id)
    return { value: p.id, label: taken ? `${p.label} · ${t('translate.agentAlreadyAdded')}` : p.label, disabled: taken }
  })
  if (!profile) profileOptions.unshift({ value: entry.profileId, label: t('translate.aiProfileMissing', { id: entry.profileId }), disabled: true })

  const modelNames = (profile ? agents.models[profile.id] : undefined)?.map((m) => m.name) ?? []
  if (profile?.defaultModel && !modelNames.includes(profile.defaultModel)) modelNames.unshift(profile.defaultModel)
  if (entry.model && !modelNames.includes(entry.model)) modelNames.unshift(entry.model)
  const modelOptions: SelectOption[] = modelNames.map((name) => ({ value: name, label: name }))
  const modelValue = entry.model || profile?.defaultModel || ''

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>{t('translate.aiProfile')}</span>
        <Select
          value={entry.profileId}
          options={profileOptions}
          loading={agents.loading}
          disabled={disabled}
          emptyLabel={t('translate.aiNoProfiles')}
          aria-label={t('translate.aiProfile')}
          onChange={(profileId) => onChange({ profileId, model: '' })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>{t('translate.aiModel')}</span>
        <Select
          value={modelValue}
          options={modelOptions}
          placeholder={t('translate.aiModelAuto')}
          disabled={disabled || !profile}
          aria-label={t('translate.aiModel')}
          onChange={(model) => onChange({ model: model === profile?.defaultModel ? '' : model })}
        />
      </label>
      <TextAction className="self-end text-[0.72rem] hover:enabled:text-fail" disabled={disabled} onClick={onRemove}>
        {t('translate.agentRemove')}
      </TextAction>
    </div>
  )
}
