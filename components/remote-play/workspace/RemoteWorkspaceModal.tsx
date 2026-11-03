'use client'

import React, { useEffect, useState } from 'react'
import { LuActivity, LuScrollText, LuSlidersHorizontal, LuX } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'

import { RemoteCheatsPanel } from './RemoteCheatsPanel'
import { RemoteDebugPanel } from './RemoteDebugPanel'
import { RemoteLogsPanel } from './RemoteLogsPanel'
import type { RemoteWorkspaceProps, RemoteWorkspaceTab } from './types'

export function RemoteWorkspaceModal({
  open,
  onClose,
  onSend,
  gameId,
  initialTab = 'cheats',
  status = 'connecting',
  latencyMs,
  videoResolution,
  hudVisible = false,
  onToggleHud,
  isPortrait,
  autoTalk,
  onToggleAutoTalk,
}: RemoteWorkspaceProps) {
  const t = useT()
  const [activeTab, setActiveTab] = useState<RemoteWorkspaceTab>(initialTab)

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('play.workspaceTitle')}
      className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col bg-paper/95 text-ink backdrop-blur-md transition-opacity select-none animate-in fade-in duration-150"
      style={{
        paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
        overscrollBehavior: 'contain',
        touchAction: 'pan-y',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 极简顶栏 (40px) */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line/40 px-2">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('common.close')}>
            <LuX size={16} />
          </Button>
          <h2 className="m-0 hidden text-xs font-semibold text-ink sm:inline-block">{t('play.workspaceTitle')}</h2>
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center gap-1 rounded-[0.25rem] bg-paper-1/80 p-0.5 border border-line/60">
          <button
            type="button"
            onClick={() => setActiveTab('cheats')}
            className={`cursor-pointer rounded-[0.2rem] px-2.5 py-1 text-xs font-medium transition-colors border-0 flex items-center gap-1.5 ${
              activeTab === 'cheats' ? 'bg-paper text-accent shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
            }`}
          >
            <LuSlidersHorizontal size={13} className="shrink-0" />
            <span>{t('play.workspaceCheats')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('debug')}
            className={`cursor-pointer rounded-[0.2rem] px-2.5 py-1 text-xs font-medium transition-colors border-0 flex items-center gap-1.5 ${
              activeTab === 'debug' ? 'bg-paper text-accent shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
            }`}
          >
            <LuActivity size={13} className="shrink-0" />
            <span>{t('play.workspaceDebug')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`cursor-pointer rounded-[0.2rem] px-2.5 py-1 text-xs font-medium transition-colors border-0 flex items-center gap-1.5 ${
              activeTab === 'logs' ? 'bg-paper text-accent shadow-[0_1px_2px_rgb(0_0_0/0.2)] font-semibold' : 'bg-transparent text-ink-soft hover:text-ink'
            }`}
          >
            <LuScrollText size={13} className="shrink-0" />
            <span>{t('play.workspaceLogs')}</span>
          </button>
        </div>

        <div className="w-8" />
      </header>

      {/* 主面板内容区：完全贴边并自适应滚动 */}
      <main className="flex-1 min-h-0 overflow-hidden px-2 pt-2 pb-1">
        {activeTab === 'cheats' ? <RemoteCheatsPanel onSend={onSend} gameId={gameId} isPortrait={isPortrait} autoTalk={autoTalk} onToggleAutoTalk={onToggleAutoTalk} /> : null}

        {activeTab === 'debug' ? (
          <RemoteDebugPanel status={status} latencyMs={latencyMs} videoResolution={videoResolution} hudVisible={hudVisible} onToggleHud={onToggleHud} isPortrait={isPortrait} />
        ) : null}

        {activeTab === 'logs' ? <RemoteLogsPanel /> : null}
      </main>
    </div>
  )
}
