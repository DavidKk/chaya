'use client'

import { type ReactNode, useMemo } from 'react'
import { IoLockClosed, IoLockOpenOutline } from 'react-icons/io5'
import { LuInfo } from 'react-icons/lu'

import { RUN_FLAG_HOTKEY_ROWS } from '@/components/game-edit/run-hotkeys'
import type { RunActionId, RunFlagKey, SessionState } from '@/components/game-edit/types'
import { useT } from '@/components/i18n/LocaleProvider'
import { formCardDense, formControlInline, formDesc, formDescInline, formFieldInlineDense, formTitle, formTitleInline } from '@/components/layoutClasses'
import { Button, NumberInput, NumberSliderInput, SwitchToggle, TextAction } from '@/components/sk'
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
  | 'autoWin'
  | 'autoBattle'
  | 'skipBattleResult'
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
  /** 未连接游戏：数值为默认值，所有控件只看不改 */
  readOnly?: boolean
  supportedFlags?: ReadonlySet<RunFlagKey> | ((key: RunFlagKey) => boolean)
  supportedActions?: ReadonlySet<RunActionId> | ((id: RunActionId) => boolean)
  hideTools?: boolean
  hideSpeedSliders?: boolean
  onGoldChange: (gold: number) => void
  onGoldLockChange: (on: boolean) => void
  /** Sets walk and run together */
  onMoveRateChange: (rate: number) => void
  onGameSpeedChange: (rate: number) => void
  onExpRateChange: (rate: number) => void
  onFlagChange: (key: RunFlagKey, on: boolean) => void
  onAction: (id: RunActionId) => void
  /** Opens 修改 › 战斗 */
  onOpenBattle?: () => void
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

/** 运行页：标题/说明占满左栏，右侧控件按内容宽 */
const runField = cn(formFieldInlineDense, 'grid-cols-[minmax(12rem,1fr)_auto]')

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
    cols: 3,
    items: [
      { id: 'scene:debug', labelKey: 'edit.actDebug' },
      { id: 'scene:pop', labelKey: 'edit.actPop' },
      { id: 'battle:start', labelKey: 'events.troop.encounterNow', variant: 'accent' },
    ],
  },
]

const FIX_GROUPS: ActionGroup[] = [
  {
    labelKey: 'edit.groupCleanup',
    cols: 2,
    items: [
      { id: 'fix:clearPictures', labelKey: 'edit.actClearPictures' },
      { id: 'fix:clearOverlay', labelKey: 'edit.actClearOverlay' },
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
    labelKey: 'edit.groupBattle',
    cols: 2,
    items: [
      { id: 'battle:victory', labelKey: 'edit.actVictoryLong', variant: 'ok' },
      { id: 'battle:escape', labelKey: 'edit.actEscapeLong' },
      { id: 'battle:defeat', labelKey: 'edit.actDefeatLong' },
      { id: 'battle:abort', labelKey: 'edit.actAbortLong' },
      { id: 'battle:enemyHp1', labelKey: 'edit.actEnemyHp1Long' },
      { id: 'battle:partyHeal', labelKey: 'edit.actPartyHealLong' },
    ],
  },
]

function isActionSupported(id: RunActionId, supported?: ReadonlySet<RunActionId> | ((id: RunActionId) => boolean)) {
  if (!supported) return true
  if (typeof supported === 'function') return supported(id)
  return supported.has(id)
}

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
  supportedActions,
  extra,
  t,
}: {
  title: string
  description: string
  groups: ActionGroup[]
  disabled: boolean
  disabledReason: string
  onAction: (id: RunActionId) => void
  supportedActions?: ReadonlySet<RunActionId> | ((id: RunActionId) => boolean)
  /** Right of the title */
  extra?: ReactNode
  t: (key: MessageKey) => string
}) {
  const visibleGroups = useMemo(() => {
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => isActionSupported(item.id, supportedActions)),
      }))
      .filter((g) => g.items.length > 0)
  }, [groups, supportedActions])

  if (visibleGroups.length === 0 && !extra) return null

  return (
    <div className={cn(formCardDense, 'm-0')}>
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className={cn(formTitle, 'flex-1')}>{title}</span>
          {extra}
        </span>
        <span className={formDesc}>{description}</span>
      </div>
      {visibleGroups.length ? (
        <div className="flex flex-col gap-3">
          {visibleGroups.map((g) => (
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
      ) : null}
    </div>
  )
}

/** 左配置 / 右工具：紧凑 formCard，尽量一屏看完 */
export function GameEditRunSettings({
  value,
  actionsEnabled = true,
  readOnly = false,
  supportedFlags,
  supportedActions,
  hideTools = false,
  hideSpeedSliders = false,
  onGoldChange,
  onGoldLockChange,
  onMoveRateChange,
  onGameSpeedChange,
  onExpRateChange,
  onFlagChange,
  onAction,
  onOpenBattle,
}: Props) {
  const t = useT()
  const goldLockTip = value.goldLocked ? t('edit.goldUnlockTip') : t('edit.goldLockTip')
  const previewDisabled = t('edit.previewDisabled')
  const readOnlyTip = t('events.runNeedLink')
  const canAct = actionsEnabled && !readOnly
  const flagFilter = typeof supportedFlags === 'function' ? supportedFlags : supportedFlags ? (k: RunFlagKey) => supportedFlags.has(k) : () => true
  const visibleFlagRows = RUN_FLAG_HOTKEY_ROWS.filter((r) => flagFilter(r.key))

  return (
    <div className="flex flex-wrap items-start gap-2 px-4 pt-3 pb-4" role="region" aria-label={t('edit.runSettingsAria')}>
      <div className={cn(formCardDense, 'm-0 w-full max-w-[42rem]')} aria-label={t('edit.configAria')}>
        <div className={runField}>
          <span className={formTitleInline}>{t('edit.gold')}</span>
          <span className={formDescInline}>{t('edit.goldDesc')}</span>
          <div className={formControlInline}>
            <NumberInput
              className="w-[7.25rem] min-w-[7.25rem]"
              value={value.gold}
              min={0}
              disabled={readOnly}
              aria-label={t('edit.gold')}
              onValueChange={(v) => onGoldChange(Math.max(0, Math.floor(v)))}
              endAction={
                <Tooltip content={readOnly ? readOnlyTip : goldLockTip}>
                  <button
                    type="button"
                    disabled={readOnly}
                    className={cn(
                      lockBtn,
                      'disabled:cursor-not-allowed',
                      value.goldLocked && 'text-accent hover:bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] hover:text-accent'
                    )}
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

        {!hideSpeedSliders ? (
          <>
            <div className={runField}>
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
                  disabled={readOnly}
                  suffix={t('edit.rateSuffix')}
                  aria-label={t('edit.gameSpeed')}
                  onValueChange={(v) => onGameSpeedChange(clampGameSpeed(v))}
                />
              </div>
            </div>

            <div className={runField}>
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
                  disabled={readOnly}
                  suffix={t('edit.rateSuffix')}
                  aria-label={t('edit.moveRate')}
                  onValueChange={(v) => onMoveRateChange(clampRate(v))}
                />
              </div>
            </div>

            <div className={runField}>
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
                  disabled={readOnly}
                  suffix={t('edit.rateSuffix')}
                  aria-label={t('edit.expRate')}
                  onValueChange={(v) => onExpRateChange(clampExp(v))}
                />
              </div>
            </div>
          </>
        ) : null}

        {visibleFlagRows.map((row) => {
          const checked = !!value[row.key]
          const label = t(row.labelKey)
          const toggle = readOnly ? undefined : () => onFlagChange(row.key, !checked)
          return (
            <div key={row.key} className={runField}>
              <span className={cn(formTitleInline, toggle && 'cursor-pointer')} onClick={toggle}>
                {label}
                {row.hintKey ? (
                  <Tooltip touchBehavior="toggle" content={<span className="block max-w-72 leading-[1.5]">{t(row.hintKey)}</span>}>
                    <button
                      type="button"
                      aria-label={t('edit.flagHelp', { name: label })}
                      className="ml-1 inline-flex cursor-help border-none bg-transparent p-0 align-[-0.125em] text-ink-soft hover:text-ink"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LuInfo size={13} aria-hidden />
                    </button>
                  </Tooltip>
                ) : null}
              </span>
              <span className={cn(formDescInline, toggle && 'cursor-pointer')} onClick={toggle}>
                {t(row.descKey)}
              </span>
              <div className={formControlInline}>
                <SwitchToggle
                  checked={checked}
                  disabled={readOnly}
                  onCheckedChange={(on) => onFlagChange(row.key, on)}
                  aria-label={label}
                  tooltip={readOnly ? readOnlyTip : checked ? t('edit.toggleOff', { name: label }) : t('edit.toggleOn', { name: label })}
                />
              </div>
            </div>
          )
        })}
      </div>

      {!hideTools ? (
        <div className="flex w-full max-w-[26rem] min-w-0 flex-col gap-2" aria-label={t('edit.toolsAria')}>
          <ActionCard
            title={t('edit.sceneTitle')}
            description={t('edit.sceneDesc')}
            groups={SCENE_GROUPS}
            disabled={!canAct}
            disabledReason={readOnly ? readOnlyTip : previewDisabled}
            onAction={onAction}
            supportedActions={supportedActions}
            t={t}
          />
          <ActionCard
            title={t('edit.fixTitle')}
            description={t('edit.fixDesc')}
            groups={FIX_GROUPS}
            disabled={!canAct}
            disabledReason={readOnly ? readOnlyTip : previewDisabled}
            onAction={onAction}
            supportedActions={supportedActions}
            t={t}
          />
          <ActionCard
            title={t('edit.battleTitle')}
            description={onOpenBattle ? t('events.battle.runMoved') : t('edit.battleDesc')}
            groups={BATTLE_GROUPS}
            disabled={!canAct}
            disabledReason={readOnly ? readOnlyTip : previewDisabled}
            onAction={onAction}
            supportedActions={supportedActions}
            extra={onOpenBattle ? <TextAction onClick={onOpenBattle}>{t('events.battle.openBattle')}</TextAction> : null}
            t={t}
          />
        </div>
      ) : null}
    </div>
  )
}
