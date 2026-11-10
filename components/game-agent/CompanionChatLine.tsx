'use client'

import { ChevronRight } from 'lucide-react'

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

  const hasThought = Boolean(line.thought && (line.thought.thought || line.thought.promptSummary || line.thought.decision))
  const returnedContent = line.text || line.thought?.decision || ''
  if (!line.card && !returnedContent && !hasThought && !pending) return null

  const charProfile = (line.character || character) in COMPANION_CHARACTER_PROFILES ? COMPANION_CHARACTER_PROFILES[line.character || character] : null
  const speakerName = line.role === 'chaya' ? charProfile?.name || line.character || character : line.role === 'player' ? t('companion.player') : '!'

  const thoughtBox =
    hasThought && line.thought ? (
      <details className="group my-1 rounded border border-line/50 bg-panel-2 px-2 py-1 text-xs" open={false}>
        <summary className="flex cursor-pointer select-none items-center justify-between text-ink-soft hover:text-ink list-none">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-[11px]" aria-hidden>
              🧠
            </span>
            <span className="font-medium text-ink">思考过程</span>
            {(typeof line.thought.durationMs === 'number' && line.thought.durationMs > 0) || line.thought.model ? (
              <span className="text-[10px] opacity-75">
                ({[line.thought.durationMs > 0 ? `${Math.round(line.thought.durationMs)}ms` : '', line.thought.model].filter(Boolean).join(' · ')})
              </span>
            ) : null}
          </div>
          <ChevronRight size={12} className="shrink-0 opacity-70 transition-transform group-open:rotate-90" aria-hidden />
        </summary>
        <div className="mt-1 space-y-1 font-mono text-[10.5px] leading-relaxed">
          {line.thought.promptSummary ? (
            <div className="text-ink-soft">
              <span className="font-semibold text-ink">分析目标：</span>
              {line.thought.promptSummary}
            </div>
          ) : null}
          {line.thought.thought ? (
            <div className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded border border-line/40 bg-surface-subtle p-2 text-ink">{line.thought.thought}</div>
          ) : null}
          {line.thought.decision && line.text ? (
            <div className="text-ink-soft">
              <span className="font-semibold text-ink">推理结论：</span>
              <span className="font-medium text-accent">{line.thought.decision}</span>
            </div>
          ) : null}
        </div>
      </details>
    ) : null

  const contentNode = line.text ? (
    line.text
  ) : line.thought?.decision ? (
    <span className="font-medium text-accent">推理结论：{line.thought.decision}</span>
  ) : pending ? (
    <span className="text-ink-soft">
      <Spinner size="sm" className="mr-1 inline-block align-middle" label={pending?.progress || t('companion.thinking')} />
      {pending?.progress || t('companion.thinking')}
    </span>
  ) : null

  if (hasThought) {
    return (
      <div className="mb-1 last:mb-0">
        <div className="break-words text-[11px] leading-4 text-ink">
          <strong className={line.role === 'error' ? 'text-fail' : line.role === 'player' ? 'text-accent' : 'text-ink'}>{speakerName}:</strong>
          {thoughtBox}
          {contentNode ? <div className="mt-0.5 break-words text-ink">{contentNode}</div> : null}
        </div>
        {card}
      </div>
    )
  }

  return (
    <div className="mb-1 last:mb-0">
      <p className="m-0 break-words text-[11px] leading-4 text-ink">
        <strong className={line.role === 'error' ? 'text-fail' : line.role === 'player' ? 'text-accent' : 'text-ink'}>{speakerName}:</strong> {contentNode}
      </p>
      {card}
    </div>
  )
}
