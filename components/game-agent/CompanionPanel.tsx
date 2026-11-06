'use client'

import { Brain, Compass, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { ConfirmProvider } from '@/components/confirm/ConfirmProvider'
import { FloatingToolPanel } from '@/components/game-tools/FloatingToolPanel'
import { MiniPanelNotice } from '@/components/game-tools/MiniPanelParts'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import { useToolSettings } from '@/components/game-tools/useToolSettings'
import { useLocaleCode, useT } from '@/components/i18n/LocaleProvider'
import { ScrollToLatestCue } from '@/components/logs/ScrollToLatestCue'
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
            variant={session.controlBusy ? 'accent' : 'plain'}
            className={cn(TOUCH_TARGET, session.controlBusy && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent')}
            aria-label={session.controlBusy ? (locale.startsWith('zh') ? '停止全托管' : 'Stop Custody') : (locale.startsWith('zh') ? '开启全托管剧情' : 'Start Story Custody')}
            tooltip={session.controlBusy ? (locale.startsWith('zh') ? '停止全托管' : 'Stop Custody') : (locale.startsWith('zh') ? '开启全托管剧情' : 'Start Story Custody')}
            onClick={() => {
              if (session.controlBusy) {
                void session.stopControl()
              } else {
                void session.sendPrompt('开启全托管剧情')
              }
            }}
          >
            {session.controlBusy ? <Square size={13} aria-hidden /> : <Compass size={13} aria-hidden />}
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
            <MiniPanelNotice>
              <div className="flex flex-col items-center gap-2">
                <span>{locale.startsWith('zh') || locale === 'cht' ? '跟旅伴聊聊天，或直接交代游戏里的事。' : 'Chat with your companion, or ask them to handle something in the game.'}</span>
                <Button
                  size="mini"
                  variant="accent"
                  className="mt-1"
                  onClick={() => void session.sendPrompt('开启全托管剧情')}
                >
                  <Compass size={12} className="mr-1" aria-hidden />
                  {locale.startsWith('zh') || locale === 'cht' ? '开启全托管剧情' : 'Start Story Custody'}
                </Button>
              </div>
            </MiniPanelNotice>
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
        {showScrollToBottom ? <ScrollToLatestCue ariaLabel={t('companion.scrollToBottom')} onActivate={scrollToBottom} className="bottom-6 [@media(hover:none)]:bottom-9" /> : null}
        {session.controlBusy ? (
          <div className="flex shrink-0 items-center justify-between border-t border-line bg-[color-mix(in_oklab,var(--accent)_12%,var(--panel-2))] px-2.5 py-1 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              <span className="h-1.5 w-1.5 shrink-0 animate-ping rounded-full bg-accent" />
              <span className="truncate font-medium text-ink">
                {session.controlProgress || (locale.startsWith('zh') || locale === 'cht' ? '全托管剧情推进中…' : 'Story custody in progress…')}
              </span>
            </div>
            <Button size="mini" variant="fail" onClick={() => void session.stopControl()}>
              {locale.startsWith('zh') || locale === 'cht' ? '停止' : 'Stop'}
            </Button>
          </div>
        ) : null}
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
