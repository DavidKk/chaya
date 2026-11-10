'use client'

import { Popover } from '@base-ui/react/popover'
import { ChevronsDown, Compass, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { IoCheckmark } from 'react-icons/io5'
import { LuHeartHandshake } from 'react-icons/lu'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { COMPANION_CHARACTERS, type CompanionCharacter, type CompanionState } from '@/lib/game-agent/companion'
import { type AiRole, loadAiRoles, subscribeAiRoles } from '@/lib/game-agent/roles'
import { cn } from '@/lib/utils'

import { AgentActivityTimeline } from './AgentActivityTimeline'
import { AutopilotGlowKeyframes } from './AutopilotGlow'
import { CompanionChatLine } from './CompanionChatLine'
import { CompanionComposer } from './CompanionComposer'
import { CompanionMemoryControls } from './CompanionMemoryControls'
import { CompanionNotices } from './CompanionNotices'
import type { GameAgentRequest } from './GameAgentWorkspace'
import { useCompanionScroll } from './useCompanionScroll'
import { loadCompanionView, saveCompanionView, useCompanionSession } from './useCompanionSession'

const TOUCH_TARGET = '[@media(hover:none)]:h-11 [@media(hover:none)]:w-11'
type Props = { gameId: string; open: boolean; observe: () => CompanionState; request: GameAgentRequest }

function CompanionSelectorMenu({ roles, currentId, disabled, onChange }: { roles: AiRole[]; currentId: string; disabled?: boolean; onChange: (id: string) => void }) {
  const locale = useLocaleCode()
  const isZh = locale.startsWith('zh') || locale === 'cht'
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<ShadowRoot>()
  const [open, setOpen] = useState(false)
  const active = roles.find((r) => r.id === currentId) || roles[0]

  useEffect(() => {
    const root = anchorRef.current?.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
  }, [])

  const title = isZh ? '选择旅伴' : 'Select Companion'
  const tooltip = isZh ? `选择旅伴\n当前：${active?.name || currentId}` : `Select Companion\nCurrent: ${active?.name || currentId}`

  return (
    <span ref={anchorRef} data-panel-interaction-active={open ? '' : undefined} className="inline-flex shrink-0">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip content={tooltip} suppressed={open}>
          <Popover.Trigger
            disabled={disabled || roles.length === 0}
            aria-label={tooltip}
            className={cn(
              'inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-soft outline-none transition-colors hover:enabled:bg-[rgb(230_238_248/0.06)] hover:enabled:text-ink focus-visible:outline-2 focus-visible:outline-accent',
              TOUCH_TARGET
            )}
          >
            <LuHeartHandshake size={15} aria-hidden />
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal container={container}>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
            <Popover.Popup
              aria-label={title}
              className="w-[17.5rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-line bg-panel-2 shadow-[0_12px_32px_rgb(0_0_0/0.4)] outline-none"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-line-soft px-3 py-1.5 text-[11px] font-semibold text-ink-soft select-none">{title}</div>
              <ScrollArea className="max-h-56" scrollClassName="max-h-56" reserveGutter={false}>
                <div className="py-1">
                  {roles.map((r) => {
                    const selected = r.id === currentId
                    const roleHasAgent = Boolean(r.provider?.trim())
                    const modelName = r.model?.trim() || (roleHasAgent ? 'auto' : '')
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={!roleHasAgent}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition',
                          selected && 'text-accent font-medium',
                          roleHasAgent ? 'text-ink hover:bg-[rgb(230_238_248/0.06)] cursor-pointer' : 'text-ink-muted opacity-50 cursor-not-allowed'
                        )}
                        onClick={() => {
                          if (!roleHasAgent) return
                          onChange(r.id)
                          setOpen(false)
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-1.5 truncate">
                          <span className="truncate">{r.name}</span>
                          {!roleHasAgent ? <span className="shrink-0 text-[10px] text-ink-muted">{isZh ? '未绑定' : 'Unbound'}</span> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {roleHasAgent && modelName ? (
                            <span className="shrink-0 max-w-[7.5rem] truncate text-[10px] text-ink-soft text-right" title={modelName}>
                              {modelName}
                            </span>
                          ) : null}
                          {selected ? <IoCheckmark size={14} className="text-accent shrink-0" aria-hidden /> : null}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  )
}

/** 局内 Agent 浮层的 React 根没有确认框，这里自带一份并挂进同一个 Shadow 根 */
export function CompanionPanel(props: Props) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null)
  return (
    <ConfirmProvider portalContainer={portal}>
      <CompanionPanelBody {...props} />
      <div ref={setPortal} />
    </ConfirmProvider>
  )
}

function CompanionPanelBody({ gameId, open, observe: _observe, request }: Props) {
  const locale = useLocaleCode()
  const t = useT()
  const toolSettings = useToolSettings(request)
  const { settings } = toolSettings
  const [companionChar, setCompanionChar] = useState<string>(() => settings.companionCharacter)
  const panel = useToolPanelVisibility('companion', settings.companionEnabled)
  const [roles, setRoles] = useState<AiRole[]>(() => loadAiRoles())

  useEffect(() => {
    setCompanionChar(settings.companionCharacter)
  }, [settings.companionCharacter])

  useEffect(() => {
    const update = () => setRoles(loadAiRoles())
    return subscribeAiRoles(update)
  }, [])

  const activeRole =
    roles.find((r) => r.id === companionChar) || roles.find((r) => r.id === settings.companionCharacter) || roles.find((r) => Boolean(r.provider?.trim())) || roles[0]
  const visible = !open && panel.visible

  const [tab, setTab] = useState<'chat' | 'activity'>(() => loadCompanionView(gameId))
  const hasAgent = Boolean(activeRole?.provider?.trim())
  const profileId = activeRole?.provider || ''
  const model = activeRole?.model || ''

  const session = useCompanionSession({
    gameId,
    visible,
    locale,
    character: (COMPANION_CHARACTERS.includes(activeRole?.id as CompanionCharacter) ? activeRole?.id : settings.companionCharacter) as CompanionCharacter,
    profileId,
    model,
    thinking: Boolean(activeRole?.thinking),
    request,
  })

  const scrollKey = `${session.messages.length}:${session.activityEvents.length}:${session.chatProgress}:${session.controlProgress}:${session.question}:${session.activeReplyId}`
  const { listRef, activityListRef, showScrollToBottom, updateScrollPosition, scrollToBottom } = useCompanionScroll(tab, scrollKey)

  useEffect(() => {
    saveCompanionView(gameId, tab)
  }, [gameId, tab])

  useEffect(() => {
    setTab(loadCompanionView(gameId))
  }, [gameId])

  const onAnswerCard = (line: (typeof session.messages)[number], optionId: string) => {
    if (line.cardState !== 'pending' || !line.cardTurnId) return
    void session.replyToCard(line.cardTurnId, optionId)
  }

  if (!visible) return null

  const activityVisible = tab === 'activity'
  const waitingCard = session.messages.some((line) => line.cardTurnId && line.cardState === 'pending')
  const canSend = !!session.agentStatus?.available && hasAgent && !session.chatBusy && !session.hostMissing

  return (
    <FloatingToolPanel
      title={
        activeRole
          ? `${locale.startsWith('zh') || locale === 'cht' ? '旅伴' : 'Companion'} · ${activeRole.name}`
          : locale.startsWith('zh') || locale === 'cht'
            ? '旅伴'
            : 'Companion'
      }
      headerTools={
        <>
          {session.controlBusy ? <AutopilotGlowKeyframes /> : null}
          <CompanionSelectorMenu
            roles={roles}
            currentId={activeRole?.id || companionChar}
            disabled={session.chatBusy}
            onChange={(nextId) => {
              setCompanionChar(nextId)
              if (COMPANION_CHARACTERS.includes(nextId as CompanionCharacter)) {
                void toolSettings.update({ companionCharacter: nextId as CompanionCharacter })
              }
            }}
          />
        </>
      }
      opacity={toolSettings}
      onClose={panel.dismiss}
      panel="companion"
      scrollContent={false}
    >
      <div className="relative flex h-full min-h-0 flex-col">
        <CompanionNotices
          locale={locale}
          agentAvailable={session.agentStatus ? session.agentStatus.available : null}
          agentReason={session.agentStatus?.reason || null}
          gameOnline={session.agentStatus?.gameOnline}
          hostStatus={session.hostStatus}
          gap={session.gap}
          hostMissing={session.hostMissing}
          cancelUnknown={session.cancelUnknown}
        />
        <CompanionMemoryControls
          locale={locale}
          hostStatus={session.hostStatus}
          controlBusy={session.controlBusy}
          activityVisible={activityVisible}
          onStartControl={() => void session.sendPrompt('开启托管')}
          onStopControl={() => void session.stopControl()}
          onToggleActivity={() => setTab(activityVisible ? 'chat' : 'activity')}
          onClearChat={session.clearChat}
        />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {tab === 'chat' ? (
            session.messages.length ? (
              <ScrollArea
                className="min-h-0 flex-1"
                scrollRef={listRef}
                scrollClassName="px-2 py-2"
                reserveGutter={false}
                scrollProps={{
                  id: 'companion-chat',
                  role: 'tabpanel',
                  'aria-label': t('companion.conversationAria'),
                  'aria-live': 'polite',
                  onScroll: (event) => updateScrollPosition(event.currentTarget, 'chat'),
                }}
              >
                {session.messages.map((line) => (
                  <CompanionChatLine
                    key={line.id}
                    line={line}
                    character={settings.companionCharacter}
                    pending={line.id === session.activeReplyId && session.chatBusy && !waitingCard ? { question: session.question, progress: session.chatProgress } : null}
                    offerLocked={session.controlBusy}
                    onAnswer={onAnswerCard}
                  />
                ))}
              </ScrollArea>
            ) : (
              <div role="status" className="m-0 flex min-h-0 flex-1 items-center justify-center px-3 py-6 text-center text-[0.7rem] leading-4 text-ink-soft">
                <div className="flex flex-col items-center gap-2">
                  <span>
                    {!hasAgent
                      ? locale.startsWith('zh') || locale === 'cht'
                        ? `当前旅伴「${activeRole?.name || ''}」未绑定 Agent 模型，请先在「AI > 旅伴」中关联模型。`
                        : `Companion "${activeRole?.name || ''}" is unbound. Please configure an agent model in AI > Companion.`
                      : locale.startsWith('zh') || locale === 'cht'
                        ? '跟旅伴聊聊天，或直接交代游戏里的事。'
                        : 'Chat with your companion, or ask them to handle something in the game.'}
                  </span>
                  {hasAgent ? (
                    <Button size="mini" variant="accent" className="mt-1" onClick={() => void session.sendPrompt('开启托管')}>
                      <Compass size={12} className="mr-1" aria-hidden />
                      {locale.startsWith('zh') || locale === 'cht' ? '开启托管' : 'Start Custody'}
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          ) : (
            <ScrollArea
              className="min-h-0 flex-1"
              scrollRef={activityListRef}
              scrollClassName="px-2 py-2"
              reserveGutter={false}
              scrollProps={{ id: 'companion-activity', role: 'tabpanel', onScroll: (event) => updateScrollPosition(event.currentTarget, 'activity') }}
            >
              <AgentActivityTimeline events={session.activityEvents} compact />
            </ScrollArea>
          )}
          {showScrollToBottom ? (
            <button
              type="button"
              role="button"
              onClick={scrollToBottom}
              className="absolute bottom-2.5 right-3 z-20 flex items-center gap-1 rounded-full border border-line bg-panel/95 px-2.5 py-1 text-[11px] font-medium text-accent shadow-md backdrop-blur transition-all hover:bg-hover hover:text-accent-hover hover:shadow-lg focus-visible:outline-2 focus-visible:outline-accent active:scale-95"
              aria-label={t('companion.scrollToBottom')}
            >
              <ChevronsDown size={14} strokeWidth={2.5} className="motion-safe:animate-bounce" aria-hidden />
              <span>{t('companion.scrollToBottom')}</span>
            </button>
          ) : null}
        </div>
        {session.controlBusy
          ? (() => {
              const text = session.controlProgress || ''
              const isDanger = text.includes('🚨') || text.includes('⚠️')
              const isBattle = text.includes('⚔️')
              const barClass = isDanger
                ? 'bg-[color-mix(in_oklab,#ef4444_22%,var(--panel-2))] border-rose-500/50'
                : isBattle
                  ? 'bg-[color-mix(in_oklab,#f59e0b_18%,var(--panel-2))] border-amber-500/40'
                  : 'bg-[color-mix(in_oklab,var(--accent)_12%,var(--panel-2))] border-line'
              const pingColor = isDanger ? 'bg-rose-500' : isBattle ? 'bg-amber-500' : 'bg-accent'
              const textClass = isDanger ? 'font-semibold text-rose-300' : isBattle ? 'font-medium text-amber-200' : 'font-medium text-ink'
              return (
                <div className={cn('flex flex-col shrink-0 border-t transition-colors', barClass)}>
                  <div className="flex shrink-0 items-center justify-between px-2.5 py-1 text-xs">
                    <div className="flex min-w-0 items-center gap-1.5 truncate">
                      <span className={cn('h-1.5 w-1.5 shrink-0 animate-ping rounded-full', pingColor)} />
                      <span className={cn('truncate', textClass)}>{text || (locale.startsWith('zh') || locale === 'cht' ? '托管推进中…' : 'Custody in progress…')}</span>
                    </div>
                    <Button
                      size="mini"
                      variant="fail"
                      className="h-5 w-5 p-0 shrink-0"
                      aria-label={locale.startsWith('zh') || locale === 'cht' ? '中止当前步骤' : 'Stop Current Step'}
                      tooltip={locale.startsWith('zh') || locale === 'cht' ? '中止当前步骤' : 'Stop Current Step'}
                      onClick={() => void session.stopControl()}
                    >
                      <Square size={10} fill="currentColor" aria-hidden />
                    </Button>
                  </div>
                </div>
              )
            })()
          : null}
        <CompanionComposer
          locale={locale}
          question={session.question}
          chatBusy={session.chatBusy}
          controlBusy={session.controlBusy}
          canSend={canSend}
          unbound={!hasAgent}
          onSend={(text) => void session.sendPrompt(text)}
          onStopChat={() => void session.cancelChat()}
          onStopControl={() => void session.stopControl()}
        />
      </div>
    </FloatingToolPanel>
  )
}
