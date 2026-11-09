'use client'

import { Brain, BrushCleaning, Compass } from 'lucide-react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { Button } from '@/components/sk'
import type { CompanionHostStatus } from '@/lib/runtime/companion-protocol'
import { cn } from '@/lib/utils'

const TOUCH_TARGET = '[@media(hover:none)]:h-11 [@media(hover:none)]:w-11'

const COPY = {
  zh: {
    context: '上下文',
    contextDefault: '上下文 --',
    startCustody: '开启托管',
    stopCustody: '停止托管',
    showThoughts: '思考过程',
    hideThoughts: '返回聊天',
    showThoughtsAria: '显示思考过程',
    hideThoughtsAria: '显示聊天',
    clearChat: '清理聊天',
    clearChatTitle: '清理旅伴聊天记录？',
    clearChatDesc: '清空本面板的聊天对话记录，不会删除旅伴游玩记忆，也不会中断托管。',
    clearChatConfirm: '清理聊天',
  },
  en: {
    context: 'Context',
    contextDefault: 'Context --',
    startCustody: 'Start Custody',
    stopCustody: 'Stop Custody',
    showThoughts: 'Thoughts',
    hideThoughts: 'Back to Chat',
    showThoughtsAria: 'Show Thoughts',
    hideThoughtsAria: 'Show Chat',
    clearChat: 'Clear chat',
    clearChatTitle: 'Clear companion chat?',
    clearChatDesc: 'Clears the conversation in this panel. Memory is preserved and custody will not stop.',
    clearChatConfirm: 'Clear chat',
  },
} as const

function formatMemorySize(bytes?: number) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  const mib = bytes / (1024 * 1024)
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MiB`
}

type Props = {
  locale: string
  hostStatus: CompanionHostStatus | null
  controlBusy: boolean
  activityVisible: boolean
  onStartControl: () => void
  onStopControl: () => void
  onToggleActivity: () => void
  onClearChat: () => void | Promise<void>
}

export function CompanionMemoryControls({ locale, hostStatus, controlBusy, activityVisible, onStartControl, onStopControl, onToggleActivity, onClearChat }: Props) {
  const confirm = useConfirm()
  const copy = locale.startsWith('zh') || locale === 'cht' ? COPY.zh : COPY.en
  const usedBytes = hostStatus?.memory?.usedBytes
  const sizeText = formatMemorySize(usedBytes)
  const contextDisplay = sizeText ? `${copy.context} ${sizeText}` : copy.contextDefault

  const clearChat = async () => {
    const approved = await confirm({
      title: copy.clearChatTitle,
      description: copy.clearChatDesc,
      confirmLabel: copy.clearChatConfirm,
      confirmVariant: 'fail',
    })
    if (!approved) return
    await onClearChat()
  }

  return (
    <div className="flex h-8 shrink-0 items-center justify-between border-y border-line bg-panel-2 px-2.5 select-none [@media(hover:none)]:h-11">
      {/* 左侧展示上下文大小 */}
      <span className="min-w-0 max-w-[12rem] truncate font-mono text-[10px] text-ink-soft select-none" title={contextDisplay}>
        {contextDisplay}
      </span>

      {/* 右侧：托管、思考过程、清理聊天，纯 ICON 按钮 */}
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="mini"
          variant="plain"
          className={cn(TOUCH_TARGET, controlBusy && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
          aria-label={controlBusy ? copy.stopCustody : copy.startCustody}
          aria-pressed={controlBusy}
          tooltip={controlBusy ? copy.stopCustody : copy.startCustody}
          onClick={controlBusy ? onStopControl : onStartControl}
        >
          <Compass size={13} className={controlBusy ? 'text-accent' : undefined} aria-hidden />
        </Button>
        <Button
          size="mini"
          variant="plain"
          className={cn(TOUCH_TARGET, activityVisible && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
          aria-label={activityVisible ? copy.hideThoughtsAria : copy.showThoughtsAria}
          aria-pressed={activityVisible}
          tooltip={activityVisible ? copy.hideThoughtsAria : copy.showThoughtsAria}
          onClick={onToggleActivity}
        >
          <Brain size={13} className={activityVisible ? 'text-accent' : undefined} aria-hidden />
        </Button>
        <Button size="mini" variant="plain" className={TOUCH_TARGET} aria-label={copy.clearChat} tooltip={copy.clearChat} onClick={() => void clearChat()}>
          <BrushCleaning size={13} aria-hidden />
        </Button>
      </div>
    </div>
  )
}
