'use client'

import { Check, CircleAlert, CircleCheck, Info } from 'lucide-react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import { CONFIRM_OPTION_IDS, type PlayerCard, type PlayerCardOption } from '@/lib/game-agent/player-card'
import { cn } from '@/lib/utils'

export type PlayerCardState = 'pending' | 'answered' | 'expired'

const TONE = {
  info: { icon: Info, className: 'border-l-info', iconClass: 'text-info' },
  success: { icon: CircleCheck, className: 'border-l-ok', iconClass: 'text-ok' },
  warn: { icon: CircleAlert, className: 'border-l-warn', iconClass: 'text-warn' },
} as const

type Props = {
  card: PlayerCard
  state: PlayerCardState
  /** 已选选项 id，或玩家直接输入的回复 */
  answer?: string
  /** 有其它操作进行中时暂不能点 */
  disabled?: boolean
  onAnswer: (optionId: string) => void
}

/** 聊天里的小卡片：确认、选择或通知；Agent 经 `chaya_player_card` 工具发起，也供陪伴面板自己提问 */
export function PlayerCardView({ card, state, answer, disabled, onAnswer }: Props) {
  const t = useT()
  const label = (option: PlayerCardOption) =>
    option.label || (option.id === CONFIRM_OPTION_IDS.yes ? t('companion.cardYes') : option.id === CONFIRM_OPTION_IDS.no ? t('companion.cardNo') : option.id)
  const tone = card.kind === 'notice' ? TONE[card.tone || 'info'] : null
  const Icon = tone?.icon
  const picked = card.options.find((option) => option.id === answer)

  return (
    <div
      role="group"
      aria-label={card.title || card.text}
      className={cn('mt-1 rounded-md bg-panel-2 px-2 py-1.5 text-[11px] leading-4 text-ink', tone && 'border-l-2', tone?.className, state === 'expired' && 'opacity-60')}
    >
      <div className="flex gap-1.5">
        {Icon ? <Icon size={13} className={cn('mt-px shrink-0', tone.iconClass)} aria-hidden /> : null}
        <div className="min-w-0">
          {card.title ? <strong className="block">{card.title}</strong> : null}
          <p className="m-0 break-words">{card.text}</p>
        </div>
      </div>
      {card.options.length && state === 'pending' ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.options.map((option, index) => (
            <Button
              key={option.id}
              variant={index === 0 ? 'accent' : 'ghost'}
              size="xs"
              className="[@media(hover:none)]:h-8"
              disabled={disabled}
              onClick={() => onAnswer(option.id)}
            >
              {label(option)}
            </Button>
          ))}
        </div>
      ) : null}
      {state === 'answered' && answer ? (
        <p className="m-0 mt-1 flex items-center gap-1 text-ink-soft">
          <Check size={12} className="shrink-0 text-ok" aria-hidden />
          <span className="min-w-0 break-words">{picked ? label(picked) : answer}</span>
        </p>
      ) : null}
      {state === 'expired' && card.options.length ? <p className="m-0 mt-1 text-ink-soft">{t('companion.cardExpired')}</p> : null}
    </div>
  )
}
