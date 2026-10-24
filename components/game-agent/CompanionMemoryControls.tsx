'use client'

import { Popover } from '@base-ui/react/popover'
import { BrushCleaning, DatabaseBackup, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { Button, SwitchToggle } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import type { CompanionHostStatus, CompanionPreferenceView } from '@/lib/runtime/companion-protocol'
import { cn } from '@/lib/utils'

import { formatCompanionError } from './companion-event-apply'
import type { useCompanionClient } from './useCompanionClient'

const TOUCH_TARGET = '[@media(hover:none)]:h-11 [@media(hover:none)]:w-11'

const COPY = {
  zh: {
    recording: '记录游玩',
    recordingOn: '关闭游玩记录',
    recordingOff: '开启游玩记录',
    natural: '自然增强',
    naturalOn: '关闭自然增强',
    naturalOff: '开启自然增强',
    clearChat: '清理聊天',
    clearChatTitle: '清理旅伴聊天记录？',
    clearChatDesc: '只清空本面板的聊天与思考展示，不会删除游玩记忆，也不会停止托管。',
    clearChatConfirm: '清理聊天',
    clearMemory: '清理记忆',
    clearMemoryTitle: '清理本游戏的游玩记忆？',
    clearMemoryDesc: '会删除已保存的游玩经历与相关偏好检索缓存，不能通过清理聊天恢复。托管不会因此停止。',
    clearMemoryConfirm: '清理记忆',
    count: '记忆',
    prefs: '发言偏好',
    verbosity: '话量',
    verbosityQuiet: '少说',
    verbosityNormal: '适中',
    verbosityChatty: '多说',
    spoilers: '剧透',
    spoilersAvoid: '避免',
    spoilersAllow: '允许',
  },
  en: {
    recording: 'Record play',
    recordingOn: 'Turn off play recording',
    recordingOff: 'Turn on play recording',
    natural: 'Natural phrasing',
    naturalOn: 'Turn off natural phrasing',
    naturalOff: 'Turn on natural phrasing',
    clearChat: 'Clear chat',
    clearChatTitle: 'Clear companion chat?',
    clearChatDesc: 'Only clears this panel’s chat and thinking view. Play memory stays, and autopilot keeps running.',
    clearChatConfirm: 'Clear chat',
    clearMemory: 'Clear memory',
    clearMemoryTitle: 'Clear play memory for this game?',
    clearMemoryDesc: 'Deletes saved play episodes and related preference caches. Clearing chat cannot undo this. Autopilot is not stopped.',
    clearMemoryConfirm: 'Clear memory',
    count: 'Memory',
    prefs: 'Talk style',
    verbosity: 'Talkativeness',
    verbosityQuiet: 'Quiet',
    verbosityNormal: 'Normal',
    verbosityChatty: 'Chatty',
    spoilers: 'Spoilers',
    spoilersAvoid: 'Avoid',
    spoilersAllow: 'Allow',
  },
} as const

type Call = ReturnType<typeof useCompanionClient>

function formatMemorySize(bytes?: number) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  }
  const mib = bytes / (1024 * 1024)
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MiB`
}

function currentPreferences(status: CompanionHostStatus | null): CompanionPreferenceView {
  return {
    verbosity: status?.preferences?.verbosity || 'normal',
    spoilers: status?.preferences?.spoilers || 'avoid',
    muteUntil: status?.preferences?.muteUntil || 0,
  }
}

function PreferenceChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="px-2 py-1.5">
      <p className="m-0 mb-1 text-[10px] text-ink-soft">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="mini"
            variant={option.value === value ? 'accent' : 'plain'}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

type Props = {
  locale: string
  hostStatus: CompanionHostStatus | null
  call: Call
  onClearChat: () => void | Promise<void>
  onHostRefresh: () => void
  onNotice: (text: string, role?: 'chaya' | 'error') => void
}

export function CompanionMemoryControls({ locale, hostStatus, call, onClearChat, onHostRefresh, onNotice }: Props) {
  const confirm = useConfirm()
  const copy = locale.startsWith('zh') || locale === 'cht' ? COPY.zh : COPY.en
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<ShadowRoot>()
  const [prefsOpen, setPrefsOpen] = useState(false)
  const recording = hostStatus?.memory.recording ?? true
  const natural = hostStatus?.naturalEnhancement ?? true
  const memory = hostStatus?.memory
  const used = formatMemorySize(memory?.usedBytes)
  const pending = typeof memory?.pendingCount === 'number' && memory.pendingCount > 0 ? memory.pendingCount : 0
  const count = memory?.count
  const usage = used ? `${copy.count} ${used}${pending ? ` · ${pending}` : ''}` : typeof count === 'number' ? `${copy.count} ${count}` : copy.recording
  const prefs = currentPreferences(hostStatus)

  useEffect(() => {
    const root = anchorRef.current?.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
  }, [])

  const patchSettings = async (patch: { recording?: boolean; naturalEnhancement?: boolean }) => {
    try {
      await call({ type: 'agent.memory.settings', requestId: crypto.randomUUID(), ...patch })
      onHostRefresh()
    } catch (error) {
      onNotice(formatCompanionError(error), 'error')
    }
  }

  const patchPreferences = async (next: Partial<CompanionPreferenceView>) => {
    try {
      await call({
        type: 'agent.memory.settings',
        requestId: crypto.randomUUID(),
        preferences: {
          verbosity: next.verbosity || prefs.verbosity,
          spoilers: next.spoilers || prefs.spoilers,
        },
      })
      onHostRefresh()
    } catch (error) {
      onNotice(formatCompanionError(error), 'error')
    }
  }

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

  const clearMemory = async () => {
    const approved = await confirm({
      title: copy.clearMemoryTitle,
      description: copy.clearMemoryDesc,
      confirmLabel: copy.clearMemoryConfirm,
      confirmVariant: 'fail',
    })
    if (!approved) return
    try {
      await call({ type: 'agent.memory.clear', requestId: crypto.randomUUID() })
      onHostRefresh()
      onNotice(copy.clearMemoryConfirm)
    } catch (error) {
      onNotice(formatCompanionError(error), 'error')
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel-2 px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-soft" title={copy.count}>
        {usage}
      </span>
      <SwitchToggle
        size="sm"
        checked={recording}
        aria-label={recording ? copy.recordingOn : copy.recordingOff}
        tooltip={recording ? copy.recordingOn : copy.recordingOff}
        onCheckedChange={(next) => void patchSettings({ recording: next })}
      />
      <SwitchToggle
        size="sm"
        checked={natural}
        aria-label={natural ? copy.naturalOn : copy.naturalOff}
        tooltip={natural ? copy.naturalOn : copy.naturalOff}
        onCheckedChange={(next) => void patchSettings({ naturalEnhancement: next })}
      />
      <span ref={anchorRef} data-panel-interaction-active={prefsOpen ? '' : undefined} className="inline-flex shrink-0">
        <Popover.Root open={prefsOpen} onOpenChange={setPrefsOpen}>
          <Tooltip content={copy.prefs} suppressed={prefsOpen}>
            <Popover.Trigger
              className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-soft outline-none transition hover:enabled:bg-[rgb(230_238_248/0.06)] hover:enabled:text-ink focus-visible:outline-2 focus-visible:outline-accent',
                TOUCH_TARGET
              )}
              aria-label={copy.prefs}
            >
              <SlidersHorizontal size={13} aria-hidden />
            </Popover.Trigger>
          </Tooltip>
          <Popover.Portal container={container}>
            <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
              <Popover.Popup
                aria-label={copy.prefs}
                className="w-52 overflow-hidden rounded-md border border-line bg-panel-2 shadow-[0_12px_32px_rgb(0_0_0/0.4)] outline-none"
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <PreferenceChoice
                  label={copy.verbosity}
                  value={prefs.verbosity}
                  options={[
                    { value: 'quiet', label: copy.verbosityQuiet },
                    { value: 'normal', label: copy.verbosityNormal },
                    { value: 'chatty', label: copy.verbosityChatty },
                  ]}
                  onChange={(value) => void patchPreferences({ verbosity: value as CompanionPreferenceView['verbosity'] })}
                />
                <PreferenceChoice
                  label={copy.spoilers}
                  value={prefs.spoilers}
                  options={[
                    { value: 'avoid', label: copy.spoilersAvoid },
                    { value: 'allow', label: copy.spoilersAllow },
                  ]}
                  onChange={(value) => void patchPreferences({ spoilers: value as CompanionPreferenceView['spoilers'] })}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </span>
      <Button size="mini" variant="plain" className={TOUCH_TARGET} aria-label={copy.clearChat} tooltip={copy.clearChat} onClick={() => void clearChat()}>
        <BrushCleaning size={13} aria-hidden />
      </Button>
      <Button size="mini" variant="plain" className={cn(TOUCH_TARGET, 'text-fail')} aria-label={copy.clearMemory} tooltip={copy.clearMemory} onClick={() => void clearMemory()}>
        <DatabaseBackup size={13} aria-hidden />
      </Button>
    </div>
  )
}
