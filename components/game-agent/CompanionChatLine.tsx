'use client'

import { useT } from '@/components/i18n/LocaleProvider'
import { Spinner } from '@/components/sk'
import { COMPANION_CHARACTER_PROFILES, type CompanionCharacter, type CompanionChest } from '@/lib/game-agent/companion'
import type { PlayerCard } from '@/lib/game-agent/player-card'

import type { ModelThought } from './companion-control-events'
import { type PlayerCardState, PlayerCardView } from './PlayerCardView'

export type ChatLine = {
  id: string
  role: 'chaya' | 'player' | 'error'
  text: string
  character?: CompanionCharacter
  /** 小卡片：Agent 经 `chaya_player_card` 发起，或旅伴自己提问 */
  card?: PlayerCard
  cardState?: PlayerCardState
  cardAnswer?: string
  /** Agent 卡片所属任务，回答时回复给它 */
  cardTurnId?: string
  /** 旅伴主动提出的宝箱托管，回答由面板自己处理 */
  offer?: CompanionChest
  thought?: ModelThought
}

type Props = {
  line: ChatLine
  character: CompanionCharacter
  /** 正在回复的空行：显示等待中的问题或进度；有卡片待答时不显示 */
  pending: { question: string; progress: string } | null
  /** 托管提议在有任务运行时不能接 */
  offerLocked: boolean
  onAnswer: (line: ChatLine, optionId: string) => void
}

export function CompanionChatLine({ line, character, pending, offerLocked, onAnswer }: Props) {
  const t = useT()
  const card = line.card ? (
    <PlayerCardView
      card={line.card}
      state={line.cardState || 'pending'}
      answer={line.cardAnswer}
      disabled={!!line.offer && offerLocked}
      onAnswer={(option) => onAnswer(line, option)}
    />
  ) : null
  if (line.card && !line.text) return <div className="mb-1 last:mb-0">{card}</div>
  if (line.thought && !line.text) return null
  if (!line.text && !pending) return null
  const charProfile = (line.character || character) in COMPANION_CHARACTER_PROFILES ? COMPANION_CHARACTER_PROFILES[line.character || character] : null
  return (
    <div className="mb-1 last:mb-0">
      <p className="m-0 break-words text-[11px] leading-4 text-ink">
        <strong className={line.role === 'error' ? 'text-fail' : line.role === 'player' ? 'text-accent' : 'text-ink'}>
          {line.role === 'chaya' ? charProfile?.name || line.character || character : line.role === 'player' ? t('companion.player') : '!'}:
        </strong>{' '}
        {line.text ? (
          line.text
        ) : pending ? (
          <span className="text-ink-soft">
            <Spinner size="sm" className="mr-1 inline-block align-middle" label={pending?.progress || t('companion.thinking')} />
            {pending?.progress || t('companion.thinking')}
          </span>
        ) : null}
      </p>
      {card}
    </div>
  )
}
