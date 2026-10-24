'use client'

import { SendHorizontal, Square } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'

import { AUTOPILOT_GLOW_CLASS } from './AutopilotGlow'

const COPY = {
  zh: {
    stopChat: '停止回复',
    stopControl: '停止托管',
    chatBusy: '回复生成中…',
  },
  en: {
    stopChat: 'Stop reply',
    stopControl: 'Stop autopilot',
    chatBusy: 'Reply in progress…',
  },
} as const

type Props = {
  locale: string
  question: string
  chatBusy: boolean
  controlBusy: boolean
  canSend: boolean
  onSend: (text: string) => void
  onStopChat: () => void
  onStopControl: () => void
}

export function CompanionComposer({ locale, question, chatBusy, controlBusy, canSend, onSend, onStopChat, onStopControl }: Props) {
  const t = useT()
  const copy = locale.startsWith('zh') || locale === 'cht' ? COPY.zh : COPY.en
  const [draft, setDraft] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || chatBusy || !canSend) return
    setDraft('')
    onSend(text)
  }

  const showStopChat = chatBusy
  const showStopControl = controlBusy && !chatBusy

  return (
    <form className="flex h-8 shrink-0 items-stretch border-t border-line bg-inset [@media(hover:none)]:h-11" onSubmit={submit}>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
        maxLength={500}
        disabled={false}
        aria-label={t('companion.inputAria')}
        placeholder={question || (chatBusy ? copy.chatBusy : controlBusy ? t('companion.autopilotPlaceholder') : t('companion.placeholder'))}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[11px] text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      />
      {showStopChat || showStopControl ? (
        <Button
          type="button"
          variant="plain"
          size="icon"
          className="h-8 w-8 shrink-0 overflow-visible text-fail hover:enabled:text-fail [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          aria-label={showStopChat ? copy.stopChat : copy.stopControl}
          tooltip={showStopChat ? copy.stopChat : copy.stopControl}
          onClick={() => (showStopChat ? onStopChat() : onStopControl())}
        >
          <Square size={showStopControl ? 12 : 13} fill="currentColor" aria-hidden className={showStopControl ? AUTOPILOT_GLOW_CLASS : undefined} />
        </Button>
      ) : (
        <Button
          type="submit"
          variant="accent"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-none [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          aria-label={t('companion.send')}
          tooltip={t('companion.send')}
          disabled={!draft.trim() || !canSend}
        >
          <SendHorizontal size={14} aria-hidden />
        </Button>
      )}
      {controlBusy && chatBusy ? (
        <Button
          type="button"
          variant="plain"
          size="icon"
          className="h-8 w-8 shrink-0 overflow-visible text-fail hover:enabled:text-fail [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          aria-label={copy.stopControl}
          tooltip={copy.stopControl}
          onClick={onStopControl}
        >
          <Square size={12} fill="currentColor" aria-hidden className={AUTOPILOT_GLOW_CLASS} />
        </Button>
      ) : null}
    </form>
  )
}
