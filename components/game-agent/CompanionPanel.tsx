'use client'

import { Brain, ChevronRight, ChevronsDown, Compass, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea } from '@/components/sk'
import { COMPANION_CHARACTER_PROFILES, type CompanionState } from '@/lib/game-agent/companion'
import { cn } from '@/lib/utils'

import { AgentActivityTimeline } from './AgentActivityTimeline'
import { AutopilotGlowKeyframes } from './AutopilotGlow'
import { CompanionChatLine } from './CompanionChatLine'
import { CompanionComposer } from './CompanionComposer'
import { CompanionMemoryControls } from './CompanionMemoryControls'
import { CompanionNotices } from './CompanionNotices'
import { GameAgentRuntimeMenu } from './GameAgentRuntimeMenu'
import type { GameAgentRequest } from './GameAgentWorkspace'
import { useCompanionScroll } from './useCompanionScroll'
import { loadCompanionView, saveCompanionView, useCompanionSession } from './useCompanionSession'

const TOUCH_TARGET = '[@media(hover:none)]:h-11 [@media(hover:none)]:w-11'
const RUNTIME_SELECTION_KEY = 'chaya.game-agent.runtime-selection'

type RuntimeSelection = { profileId: string; model: string }
type Props = { gameId: string; open: boolean; observe: () => CompanionState; request: GameAgentRequest }

function loadRuntimeSelection(): RuntimeSelection {
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_SELECTION_KEY) || 'null') as Partial<RuntimeSelection> | null
    return { profileId: typeof value?.profileId === 'string' ? value.profileId : '', model: typeof value?.model === 'string' ? value.model : '' }
  } catch {
    return { profileId: '', model: '' }
  }
}

function saveRuntimeSelection(selection: RuntimeSelection) {
  if (!selection.profileId || !selection.model) return
  try {
    localStorage.setItem(RUNTIME_SELECTION_KEY, JSON.stringify(selection))
  } catch {
    // Runtime state still works when storage is unavailable.
  }
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
  const panel = useToolPanelVisibility('companion', settings.companionEnabled)
  const character = COMPANION_CHARACTER_PROFILES[settings.companionCharacter]
  const visible = !open && panel.visible

  const [tab, setTab] = useState<'chat' | 'activity'>(() => loadCompanionView(gameId))
  const [profileId, setProfileId] = useState(() => loadRuntimeSelection().profileId)
  const [model, setModel] = useState(() => loadRuntimeSelection().model)

  const onProfiles = useCallback(
    (status: { profiles: Array<{ id: string; models: { name: string }[]; defaultModel: string }>; defaultProfileId: string }) => {
      const nextId = status.profiles.some((profile) => profile.id === profileId) ? profileId : status.defaultProfileId
      const nextProfile = status.profiles.find((profile) => profile.id === nextId)
      setProfileId(nextId)
      setModel((current) => (nextProfile?.models.some((item) => item.name === current) ? current : nextProfile?.defaultModel || ''))
    },
    [profileId]
  )

  const session = useCompanionSession({
    gameId,
    visible,
    locale,
    character: settings.companionCharacter,
    profileId,
    model,
    request,
    onProfiles,
  })

  const scrollKey = `${session.messages.length}:${session.activityEvents.length}:${session.chatProgress}:${session.controlProgress}:${session.question}:${session.activeReplyId}`
  const { listRef, activityListRef, showScrollToBottom, updateScrollPosition, scrollToBottom } = useCompanionScroll(tab, scrollKey)

  useEffect(() => {
    saveRuntimeSelection({ profileId, model })
  }, [model, profileId])

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
  const viewLabel = t(activityVisible ? 'companion.showChat' : 'companion.showActivity')
  const waitingCard = session.messages.some((line) => line.cardTurnId && line.cardState === 'pending')
  const canSend = !!session.agentStatus?.available && !!profileId && !!model && !session.chatBusy && !session.hostMissing

  return (
    <FloatingToolPanel
      title={character.name}
      headerTools={
        <>
          {session.controlBusy ? <AutopilotGlowKeyframes /> : null}
          <Button
            size="mini"
            variant="plain"
            className={cn(
              TOUCH_TARGET,
              session.controlBusy &&
                'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent hover:enabled:bg-[color-mix(in_oklab,var(--accent)_24%,transparent)] hover:enabled:text-accent'
            )}
            aria-label={session.controlBusy ? (locale.startsWith('zh') ? '停止托管' : 'Stop Custody') : locale.startsWith('zh') ? '开启托管' : 'Start Custody'}
            aria-pressed={session.controlBusy}
            tooltip={session.controlBusy ? (locale.startsWith('zh') ? '停止托管' : 'Stop Custody') : locale.startsWith('zh') ? '开启托管' : 'Start Custody'}
            onClick={() => {
              if (session.controlBusy) {
                void session.stopControl()
              } else {
                void session.sendPrompt('开启托管')
              }
            }}
          >
            <Compass size={13} className={session.controlBusy ? 'text-accent' : undefined} aria-hidden />
          </Button>
          <Button
            size="mini"
            variant="plain"
            className={cn(TOUCH_TARGET, activityVisible && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
            aria-label={viewLabel}
            aria-pressed={activityVisible}
            tooltip={viewLabel}
            onClick={() => setTab(activityVisible ? 'chat' : 'activity')}
          >
            <Brain size={13} aria-hidden />
          </Button>
          <GameAgentRuntimeMenu
            compact
            profiles={session.agentStatus?.profiles || []}
            profileId={profileId}
            model={model}
            disabled={session.chatBusy}
            showThinking={false}
            onChange={(nextProfile, nextModel) => {
              setProfileId(nextProfile)
              setModel(nextModel)
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
          call={session.call}
          onClearChat={session.clearChat}
          onHostRefresh={() => void session.refreshHostStatus()}
          onNotice={(text, role = 'chaya') => session.append({ id: crypto.randomUUID(), role, text, character: settings.companionCharacter })}
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
                    {locale.startsWith('zh') || locale === 'cht'
                      ? '跟旅伴聊聊天，或直接交代游戏里的事。'
                      : 'Chat with your companion, or ask them to handle something in the game.'}
                  </span>
                  <Button size="mini" variant="accent" className="mt-1" onClick={() => void session.sendPrompt('开启托管')}>
                    <Compass size={12} className="mr-1" aria-hidden />
                    {locale.startsWith('zh') || locale === 'cht' ? '开启托管' : 'Start Custody'}
                  </Button>
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
                      aria-label={locale.startsWith('zh') || locale === 'cht' ? '停止托管' : 'Stop Custody'}
                      tooltip={locale.startsWith('zh') || locale === 'cht' ? '停止托管' : 'Stop Custody'}
                      onClick={() => void session.stopControl()}
                    >
                      <Square size={10} fill="currentColor" aria-hidden />
                    </Button>
                  </div>
                  {session.latestThought ? (
                    <details className="group border-t border-line/50 px-2.5 py-1 text-xs" open={false}>
                      <summary className="flex cursor-pointer select-none items-center justify-between text-ink-soft hover:text-ink list-none">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-[11px]" aria-hidden>
                            🧠
                          </span>
                          <span className="font-medium text-ink">思考过程</span>
                          <span className="text-[10px] opacity-75">
                            ({session.latestThought.durationMs}ms · {session.latestThought.model || 'model'})
                          </span>
                        </div>
                        <ChevronRight size={12} className="shrink-0 opacity-70 transition-transform group-open:rotate-90" aria-hidden />
                      </summary>
                      <div className="mt-1.5 space-y-1 font-mono text-[11px] leading-relaxed pb-0.5">
                        {session.latestThought.promptSummary ? (
                          <div className="text-ink-soft">
                            <span className="font-semibold text-ink">分析目标：</span>
                            {session.latestThought.promptSummary}
                          </div>
                        ) : null}
                        {session.latestThought.thought ? (
                          <div className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded border border-line/40 bg-surface-subtle p-2 text-ink">
                            {session.latestThought.thought}
                          </div>
                        ) : null}
                        {session.latestThought.decision ? (
                          <div className="text-ink-soft">
                            <span className="font-semibold text-ink">推理结论：</span>
                            <span className="font-medium text-accent">{session.latestThought.decision}</span>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
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
          onSend={(text) => void session.sendPrompt(text)}
          onStopChat={() => void session.cancelChat()}
          onStopControl={() => void session.stopControl()}
        />
      </div>
    </FloatingToolPanel>
  )
}
