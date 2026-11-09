'use client'

import { SendHorizontal, Square } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'

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
  unbound?: boolean
  onSend: (text: string) => void
  onStopChat: () => void
  onStopControl: () => void
}

export function CompanionComposer({ locale, question, chatBusy, controlBusy, canSend, unbound, onSend, onStopChat, onStopControl: _onStopControl }: Props) {
  const t = useT()
  const isZh = locale.startsWith('zh') || locale === 'cht'
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
        placeholder={
          question ||
          (unbound
            ? isZh
              ? '当前旅伴未绑定 Agent，请先在「AI > 旅伴」中配置'
              : 'Companion has no agent configured'
            : chatBusy
              ? copy.chatBusy
              : controlBusy
                ? t('companion.autopilotPlaceholder')
                : t('companion.placeholder'))
        }
        className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[11px] text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      />
      {showStopChat ? (
        <Button
          type="button"
          variant="plain"
          size="icon"
          className="h-8 w-8 shrink-0 overflow-visible text-fail hover:enabled:text-fail [@media(hover:none)]:h-11 [@media(hover:none)]:w-11"
          aria-label={copy.stopChat}
          tooltip={copy.stopChat}
          onClick={onStopChat}
        >
          <Square size={13} fill="currentColor" aria-hidden />
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
    </form>
  )
}
