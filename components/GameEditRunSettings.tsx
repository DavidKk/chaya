'use client'

import { IoLockClosed, IoLockOpenOutline } from 'react-icons/io5'

import { RUN_FLAG_HOTKEY_ROWS } from '@/components/game-edit/run-hotkeys'
import type { RunActionId, RunFlagKey, SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense, formControlInline, formDesc, formDescInline, formFieldInlineDense, formTitle, formTitleInline } from '@/components/layoutClasses'
import { Button, NumberInput, NumberSliderInput, SwitchToggle } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import type { MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type GameEditRunSettingsState = Pick<
  SessionState,
  | 'gold'
  | 'walkRate'
  | 'gameSpeed'
  | 'fullscreen'
  | 'alwaysDash'
  | 'god'
  | 'through'
  | 'autotalk'
  | 'encounter'
  | 'menuEnabled'
  | 'saveEnabled'
  | 'clickMove'
  | 'followers'
  | 'clickTeleport'
  | 'resourceSkip'
  | 'expRate'
> & { goldLocked: boolean }

type Props = {
  value: GameEditRunSettingsState
  /** 局内可执行动作；网页预览可传空操作 */
  actionsEnabled?: boolean
  onGoldChange: (gold: number) => void
  onGoldLockChange: (on: boolean) => void
  /** Sets walk and run together */
  onMoveRateChange: (rate: number) => void
  onGameSpeedChange: (rate: number) => void
  onExpRateChange: (rate: number) => void
  onFlagChange: (key: RunFlagKey, on: boolean) => void
  onAction: (id: RunActionId) => void
}

function clampRate(n: number) {
  if (!Number.isFinite(n)) return 1
  return Math.min(8, Math.max(0.5, Math.round(n * 100) / 100))
}

function clampGameSpeed(n: number) {
  if (!Number.isFinite(n)) return 1
  return Math.min(5, Math.max(1, Math.round(n * 100) / 100))
}

function clampExp(n: number) {
  if (!Number.isFinite(n)) return 1
  return Math.min(99, Math.max(0, Math.round(n * 100) / 100))
}

const lockBtn = cn(
  'm-0 inline-flex h-[1.35rem] w-[1.35rem] cursor-pointer items-center justify-center rounded-[0.15rem] border-none bg-transparent p-0 text-ink-soft',
  'hover:bg-[color-mix(in_oklab,var(--panel-2)_70%,transparent)] hover:text-ink',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_55%,transparent)]'
)

type ActionItem = {
  id: RunActionId
  labelKey: MessageKey
  variant?: 'default' | 'ok' | 'fail' | 'accent'
}

type ActionGroup = { labelKey: MessageKey; cols?: 2 | 3 | 4; items: ActionItem[] }

const SCENE_GROUPS: ActionGroup[] = [
  {
    labelKey: 'edit.groupCharacter',
    cols: 4,
    items: [
      { id: 'scene:status', labelKey: 'edit.actStatus' },
      { id: 'scene:equip', labelKey: 'edit.actEquip' },
      { id: 'scene:skill', labelKey: 'edit.actSkill' },
      { id: 'scene:item', labelKey: 'edit.actItem' },
    ],
  },
  {
    labelKey: 'edit.groupSystem',
    cols: 4,
    items: [
      { id: 'scene:menu', labelKey: 'edit.actMenu' },
      { id: 'scene:load', labelKey: 'edit.actLoad' },
      { id: 'scene:save', labelKey: 'edit.actSave' },
      { id: 'scene:options', labelKey: 'edit.actOptions' },
    ],
  },
  {
    labelKey: 'edit.groupOther',
    cols: 2,
    items: [
      { id: 'scene:debug', labelKey: 'edit.actDebug' },
      { id: 'scene:pop', labelKey: 'edit.actPop' },
    ],
  },
]

const FIX_GROUPS: ActionGroup[] = [
  {
    labelKey: 'edit.groupCleanup',
    cols: 2,
    items: [
      { id: 'fix:clearPictures', labelKey: 'edit.actClearPictures' },
      { id: 'fix:clearEvent', labelKey: 'edit.actClearEvent' },
      { id: 'fix:clearMoveRoute', labelKey: 'edit.actClearMove' },
      { id: 'fix:closeWindows', labelKey: 'edit.actCloseWindows' },
    ],
  },
  {
    labelKey: 'edit.groupJump',
    cols: 2,
    items: [
      { id: 'fix:title', labelKey: 'edit.actTitle' },
      { id: 'fix:map', labelKey: 'edit.actMap' },
      { id: 'fix:fadeIn', labelKey: 'edit.actFadeIn' },
      { id: 'fix:resume', labelKey: 'edit.actResume' },
    ],
  },
]

const BATTLE_GROUPS: ActionGroup[] = [
  {
    labelKey: 'edit.groupEndBattle',
    cols: 4,
    items: [
      { id: 'battle:victory', labelKey: 'edit.actVictory', variant: 'ok' },
      { id: 'battle:escape', labelKey: 'edit.actEscape' },
      { id: 'battle:defeat', labelKey: 'edit.actDefeat', variant: 'fail' },
      { id: 'battle:abort', labelKey: 'edit.actAbort' },
    ],
  },
  {
    labelKey: 'edit.groupEnemy',
    cols: 2,
    items: [
      { id: 'battle:enemyHp1', labelKey: 'edit.actEnemyHp1' },
      { id: 'battle:enemyHpMax', labelKey: 'edit.actEnemyHpMax' },
    ],
  },
  {
    labelKey: 'edit.groupParty',
    cols: 3,
    items: [
      { id: 'battle:partyHeal', labelKey: 'edit.actPartyHeal', variant: 'ok' },
      { id: 'battle:partyHp1', labelKey: 'edit.actPartyHp1' },
      { id: 'battle:partyHp0', labelKey: 'edit.actPartyHp0', variant: 'fail' },
    ],
  },
]

const gridCols = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
} as const

function ActionCard({
  title,
  description,
  groups,
  disabled,
  disabledReason,
  onAction,
  t,
}: {
  title: string
  description: string
  groups: ActionGroup[]
  disabled: boolean
  disabledReason: string
  onAction: (id: RunActionId) => void
  t: (key: MessageKey) => string
}) {
  return (
    <div className={cn(formCardDense, 'm-0')}>
      <div className="flex flex-col gap-1">
        <span className={formTitle}>{title}</span>
        <span className={formDesc}>{description}</span>
      </div>
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.labelKey} className="flex flex-col gap-2">
            <span className="text-[0.68rem] font-semibold tracking-[0.04em] text-ink-soft uppercase">{t(g.labelKey)}</span>
            <div className={cn('grid gap-2', gridCols[g.cols ?? 2])}>
              {g.items.map((a) => (
                <Button
                  key={a.id}
                  className="w-full min-w-0 px-2"
                  variant={a.variant ?? 'default'}
                  size="md"
                  disabled={disabled}
                  tooltip={disabled ? disabledReason : undefined}
                  onClick={() => onAction(a.id)}
                >
                  {t(a.labelKey)}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 左配置 / 右工具：紧凑 formCard，尽量一屏看完 */
export function GameEditRunSettings({
  value,
  actionsEnabled = true,
  onGoldChange,
  onGoldLockChange,
  onMoveRateChange,
  onGameSpeedChange,
  onExpRateChange,
  onFlagChange,
  onAction,
}: Props) {
  const t = useT()
  const goldLockTip = value.goldLocked ? t('edit.goldUnlockTip') : t('edit.goldLockTip')
  const previewDisabled = t('edit.previewDisabled')
  const battlePreviewDisabled = t('edit.battlePreviewDisabled')

  return (
    <div className="flex flex-wrap items-start gap-2 px-4 pt-3 pb-4" role="region" aria-label={t('edit.runSettingsAria')}>
      <div className={cn(formCardDense, 'm-0 w-full max-w-[36rem]')} aria-label={t('edit.configAria')}>
        <div className={formFieldInlineDense}>
          <span className={formTitleInline}>{t('edit.gold')}</span>
          <span className={formDescInline}>{t('edit.goldDesc')}</span>
          <div className={formControlInline}>
            <NumberInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={value.gold}
              min={0}
              aria-label={t('edit.gold')}
              onValueChange={(v) => onGoldChange(Math.max(0, Math.floor(v)))}
              endAction={
                <Tooltip content={goldLockTip}>
                  <button
                    type="button"
                    className={cn(lockBtn, value.goldLocked && 'text-accent hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:text-accent')}
                    aria-label={value.goldLocked ? t('edit.goldUnlock') : t('edit.goldLock')}
                    aria-pressed={value.goldLocked}
                    onClick={() => onGoldLockChange(!value.goldLocked)}
                  >
                    {value.goldLocked ? <IoLockClosed size={15} aria-hidden /> : <IoLockOpenOutline size={15} aria-hidden />}
                  </button>
                </Tooltip>
              }
            />
          </div>
        </div>

        <div className={formFieldInlineDense}>
          <span className={formTitleInline}>{t('edit.gameSpeed')}</span>
          <span className={formDescInline}>{t('edit.gameSpeedDesc')}</span>
          <div className={formControlInline}>
            <NumberSliderInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={value.gameSpeed}
              min={1}
              max={5}
              step={0.25}
              allowDecimal
              suffix={t('edit.rateSuffix')}
              aria-label={t('edit.gameSpeed')}
              onValueChange={(v) => onGameSpeedChange(clampGameSpeed(v))}
            />
          </div>
        </div>

        <div className={formFieldInlineDense}>
          <span className={formTitleInline}>{t('edit.moveRate')}</span>
          <span className={formDescInline}>{t('edit.moveRateDesc')}</span>
          <div className={formControlInline}>
            <NumberSliderInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={value.walkRate}
              min={0.5}
              max={8}
              step={0.25}
              allowDecimal
              suffix={t('edit.rateSuffix')}
              aria-label={t('edit.moveRate')}
              onValueChange={(v) => onMoveRateChange(clampRate(v))}
            />
          </div>
        </div>

        <div className={formFieldInlineDense}>
          <span className={formTitleInline}>{t('edit.expRate')}</span>
          <span className={formDescInline}>{t('edit.expRateDesc')}</span>
          <div className={formControlInline}>
            <NumberSliderInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={value.expRate}
              min={0}
              max={99}
              step={0.25}
              allowDecimal
              suffix={t('edit.rateSuffix')}
              aria-label={t('edit.expRate')}
              onValueChange={(v) => onExpRateChange(clampExp(v))}
            />
          </div>
        </div>

        {RUN_FLAG_HOTKEY_ROWS.map((row) => {
          const checked = !!value[row.key]
          const label = t(row.labelKey)
          return (
            <div key={row.key} className={formFieldInlineDense}>
              <span className={cn(formTitleInline, 'cursor-pointer')} onClick={() => onFlagChange(row.key, !checked)}>
                {label}
              </span>
              <span className={cn(formDescInline, 'cursor-pointer')} onClick={() => onFlagChange(row.key, !checked)}>
                {t(row.descKey)}
              </span>
              <div className={formControlInline}>
                <SwitchToggle
                  checked={checked}
                  onCheckedChange={(on) => onFlagChange(row.key, on)}
                  aria-label={label}
                  tooltip={checked ? t('edit.toggleOff', { name: label }) : t('edit.toggleOn', { name: label })}
                />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex w-full max-w-[26rem] min-w-0 flex-col gap-2" aria-label={t('edit.toolsAria')}>
        <ActionCard
          title={t('edit.sceneTitle')}
          description={t('edit.sceneDesc')}
          groups={SCENE_GROUPS}
          disabled={!actionsEnabled}
          disabledReason={previewDisabled}
          onAction={onAction}
          t={t}
        />
        <ActionCard
          title={t('edit.fixTitle')}
          description={t('edit.fixDesc')}
          groups={FIX_GROUPS}
          disabled={!actionsEnabled}
          disabledReason={previewDisabled}
          onAction={onAction}
          t={t}
        />
        <ActionCard
          title={t('edit.battleTitle')}
          description={t('edit.battleDesc')}
          groups={BATTLE_GROUPS}
          disabled={!actionsEnabled}
          disabledReason={battlePreviewDisabled}
          onAction={onAction}
          t={t}
        />
      </div>
    </div>
  )
}
