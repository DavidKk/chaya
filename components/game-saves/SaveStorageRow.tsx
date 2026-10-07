'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { formControlInline, formDescInline, formTitleInline } from '@/components/layoutClasses'
import { Select } from '@/components/sk'
import { type GameSaveList, type GameSavesSettings, isGameSaveStorage, saveStorageOf } from '@/lib/game/game-saves'
import { cn } from '@/lib/utils'

import { settingsRow } from './SaveCard'

type Props = {
  list: GameSaveList
  settings: GameSavesSettings
  disabled: boolean
  /** Chaya 本机服务不可用（非本机模式）：不能改为存到 Chaya 本机 */
  appUnavailable: boolean
  onChange: (patch: Partial<GameSavesSettings>) => void
}

/** 存档卡片设置区的「存储位置」：存到游戏中（默认）或 Chaya 本机 */
export function SaveStorageRow({ list, settings, disabled, appUnavailable, onChange }: Props) {
  const t = useT()
  const value = saveStorageOf(settings, list)
  const blocked = appUnavailable && value !== 'app'
  return (
    <div className={settingsRow}>
      <span className={formTitleInline}>{t('saves.storage.title')}</span>
      <span className={cn(formDescInline, 'flex flex-col')}>
        <span>{blocked ? t('saves.storage.appUnavailable') : t(value === 'app' ? 'saves.storage.appHint' : 'saves.storage.gameHint')}</span>
        <span>{t('saves.storage.desc')}</span>
      </span>
      <div className={formControlInline}>
        <Select
          className="w-40"
          value={value}
          options={[
            { value: 'game', label: t('saves.storage.game') },
            { value: 'app', label: t('saves.storage.app'), disabled: blocked },
          ]}
          disabled={disabled}
          aria-label={t('saves.storage.title')}
          onChange={(next) => {
            if (!isGameSaveStorage(next) || next === value) return
            onChange(list === 'quick' ? { quickStorage: next } : { autoStorage: next })
          }}
        />
      </div>
    </div>
  )
}
