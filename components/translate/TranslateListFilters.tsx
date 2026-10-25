'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Select } from '@/components/sk'

export function TranslateListFilters(props: {
  natureFilter: string
  categoryFilter: string
  statusFilter: string
  onNature: (value: string) => void
  onCategory: (value: string) => void
  onStatus: (value: string) => void
}) {
  const t = useT()
  return (
    <>
      <Select
        className="w-28 shrink-0"
        panelWidth="content"
        value={props.natureFilter}
        onChange={(val) => props.onNature(val)}
        options={[
          { value: 'all', label: t('translate.natureFilterAll') },
          { value: 'dialogue', label: t('translate.catDialogue') },
          { value: 'story', label: t('translate.catStory') },
          { value: 'choice', label: t('translate.catChoice') },
          { value: 'name', label: t('translate.natureFilterName') },
          { value: 'desc', label: t('translate.natureFilterDesc') },
          { value: 'system', label: t('translate.natureFilterSystem') },
          { value: 'hardcoded', label: t('translate.natureFilterHardcoded') },
          { value: 'locales', label: t('translate.natureFilterLocales') },
        ]}
        aria-label={t('translate.natureFilterAria')}
        tooltip={t('translate.natureFilterTooltip')}
      />
      <Select
        className="w-28 shrink-0"
        panelWidth="content"
        value={props.categoryFilter}
        onChange={(val) => props.onCategory(val)}
        options={[
          { value: 'all', label: t('translate.catAll') },
          { value: 'dialogue', label: t('translate.catDialogue') },
          { value: 'story', label: t('translate.catStory') },
          { value: 'choice', label: t('translate.catChoice') },
          { value: 'item', label: t('translate.catItem') },
          { value: 'item_desc', label: t('translate.catItemDesc') },
          { value: 'weapon', label: t('translate.catWeapon') },
          { value: 'weapon_desc', label: t('translate.catWeaponDesc') },
          { value: 'armor', label: t('translate.catArmor') },
          { value: 'armor_desc', label: t('translate.catArmorDesc') },
          { value: 'skill', label: t('translate.catSkill') },
          { value: 'skill_desc', label: t('translate.catSkillDesc') },
          { value: 'map', label: t('translate.catMap') },
          { value: 'actor', label: t('translate.catActor') },
          { value: 'actor_nickname', label: t('translate.catActorNickname') },
          { value: 'actor_profile', label: t('translate.catActorProfile') },
          { value: 'enemy', label: t('translate.catEnemy') },
          { value: 'state', label: t('translate.catState') },
          { value: 'system', label: t('translate.catSystem') },
          { value: 'plugin', label: t('translate.catPlugin') },
          { value: 'resource', label: t('translate.catResource') },
          { value: 'other', label: t('translate.catOther') },
        ]}
        aria-label={t('translate.listCategoryFilterAria')}
        tooltip={t('translate.listCategoryFilterTooltip')}
      />
      <Select
        className="w-24 shrink-0"
        panelWidth="content"
        value={props.statusFilter}
        onChange={(val) => props.onStatus(val)}
        options={[
          { value: 'all', label: t('translate.statusAll') },
          { value: 'untranslated', label: t('translate.statusUntranslated') },
          { value: 'failed', label: t('translate.statusFailed') },
          { value: 'translated', label: t('translate.statusTranslated') },
          { value: 'manual', label: t('translate.statusManual') },
        ]}
        aria-label={t('translate.listStatusFilterAria')}
        tooltip={t('translate.listStatusFilterTooltip')}
      />
    </>
  )
}
