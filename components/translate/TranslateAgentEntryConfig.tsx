'use client'

import { useState } from 'react'
import { IoCheckmark, IoCloseOutline, IoTrashOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, Select, type SelectOption } from '@/components/sk'
import type { TranslateAgentProfiles } from '@/components/translate/useTranslateAgentProfiles'
import type { TranslateAgentEntry } from '@/lib/translate/engines'
import { cn } from '@/lib/utils'

type EntryDraft = Pick<TranslateAgentEntry, 'profileId' | 'model'>

type Props = {
  entry: TranslateAgentEntry
  agents: TranslateAgentProfiles
  /** 其它条目已用的实例；同一实例只能添加一次 */
  takenProfileIds?: string[]
  disabled?: boolean
  onSave: (patch: EntryDraft) => void
  onCancel: () => void
  onRemove: () => void
}

const fieldLabel = 'text-[0.72rem] font-medium text-ink-soft'
const miniIcon = 'h-6 w-6'

/** 一条 Agent 翻译条目：换实例、选模型（保存后生效）、移除 */
export function TranslateAgentEntryConfig({ entry, agents, takenProfileIds = [], disabled, onSave, onCancel, onRemove }: Props) {
  const t = useT()
  const [draft, setDraft] = useState<EntryDraft>({ profileId: entry.profileId, model: entry.model })
  const dirty = draft.profileId !== entry.profileId || draft.model !== entry.model
  const profile = agents.profiles.find((p) => p.id === draft.profileId)
  const profileOptions: SelectOption[] = agents.profiles.map((p) => {
    const taken = takenProfileIds.includes(p.id)
    return { value: p.id, label: taken ? `${p.label} · ${t('translate.agentAlreadyAdded')}` : p.label, disabled: taken }
  })
  if (!profile) profileOptions.unshift({ value: draft.profileId, label: t('translate.aiProfileMissing', { id: draft.profileId }), disabled: true })

  const modelNames = (profile ? agents.models[profile.id] : undefined)?.map((m) => m.name) ?? []
  if (profile?.defaultModel && !modelNames.includes(profile.defaultModel)) modelNames.unshift(profile.defaultModel)
  if (draft.model && !modelNames.includes(draft.model)) modelNames.unshift(draft.model)
  const modelOptions: SelectOption[] = modelNames.map((name) => ({ value: name, label: name }))
  const modelValue = draft.model || profile?.defaultModel || ''

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>{t('translate.aiProfile')}</span>
        <Select
          value={draft.profileId}
          options={profileOptions}
          loading={agents.loading}
          disabled={disabled}
          emptyLabel={t('translate.aiNoProfiles')}
          aria-label={t('translate.aiProfile')}
          onChange={(profileId) => setDraft({ profileId, model: '' })}
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
          onChange={(model) => setDraft((cur) => ({ ...cur, model: model === profile?.defaultModel ? '' : model }))}
        />
      </label>
      <div className="flex items-center gap-1">
        <Button
          variant="plain"
          size="icon"
          className={cn(miniIcon, 'text-fail hover:enabled:text-fail')}
          aria-label={t('translate.agentRemove')}
          disabled={disabled}
          onClick={onRemove}
        >
          <IoTrashOutline size={13} aria-hidden />
        </Button>
        <span className="flex-1" />
        <Button variant="plain" size="icon" className={miniIcon} aria-label={t('common.cancel')} disabled={disabled} onClick={onCancel}>
          <IoCloseOutline size={15} aria-hidden />
        </Button>
        <Button
          variant="plain"
          size="icon"
          className={cn(miniIcon, 'hover:enabled:text-accent')}
          aria-label={t('common.save')}
          disabled={disabled || !dirty}
          onClick={() => onSave(draft)}
        >
          <IoCheckmark size={15} aria-hidden />
        </Button>
      </div>
    </div>
  )
}
