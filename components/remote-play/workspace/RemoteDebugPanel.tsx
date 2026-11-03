'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { LuActivity, LuBug, LuCheck, LuTerminal } from 'react-icons/lu'

import { Badge, Button, ScrollArea } from '@/components/sk'
import { destroyErudaMobileDevTools, initErudaMobileDevTools, isErudaActive } from '@/lib/runtime/mobile-devtools'
import { remotePlayLogger } from '@/lib/runtime/remote-play-logger'

import { copyToClipboard } from './clipboard'
import type { RemoteWorkspaceProps } from './types'

export function RemoteDebugPanel({
  status = 'connecting',
  latencyMs,
  videoResolution,
  hudVisible = false,
  onToggleHud,
  isPortrait,
}: Pick<RemoteWorkspaceProps, 'status' | 'latencyMs' | 'videoResolution' | 'hudVisible' | 'onToggleHud' | 'isPortrait'>) {
  const [devToolsActive, setDevToolsActive] = useState(false)
  const [copiedMacCmd, setCopiedMacCmd] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    setDevToolsActive(isErudaActive())
  }, [])

  const diagnostics = useMemo(() => remotePlayLogger.getDiagnostics(), [])

  const showFeedback = (text: string) => {
    setFeedback(text)
    setTimeout(() => {
      setFeedback((cur) => (cur === text ? null : cur))
    }, 2400)
  }

  const handleToggleDevTools = async () => {
    if (devToolsActive) {
      destroyErudaMobileDevTools()
      setDevToolsActive(false)
      showFeedback('已关闭手机 DevTools 控制台')
    } else {
      const ok = await initErudaMobileDevTools()
      if (ok) {
        setDevToolsActive(true)
        showFeedback('手机 DevTools 已启动 (屏幕右下角)')
      } else {
        showFeedback('启动 DevTools 失败')
      }
    }
  }

  const handleCopyMacCmd = async () => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    const port = typeof window !== 'undefined' && window.location.port ? window.location.port : '3000'
    const cmd = `curl -N "http://${hostname}:${port}/api/logs/stream?source=remote-play"`
    const ok = await copyToClipboard(cmd)
    if (ok) {
      setCopiedMacCmd(true)
      showFeedback('已复制 Mac 终端监视命令到剪贴板')
      setTimeout(() => setCopiedMacCmd(false), 2000)
    } else {
      showFeedback('复制失败，请手动选取')
    }
  }

  const isPortraitEffective = isPortrait ?? (typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false)

  return (
    <div className="flex h-full flex-col min-h-0">
      {feedback ? (
        <div className="mb-2 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-center text-xs font-semibold text-accent animate-in fade-in duration-150">
          {feedback}
        </div>
      ) : null}

      <ScrollArea className="flex-1 min-h-0" indicator="vertical">
        <div className={isPortraitEffective ? 'space-y-3 pb-4' : 'grid grid-cols-2 gap-3 pb-3'}>
          {/* 链路指标卡 */}
          <section className="rounded-lg border border-line bg-paper-1/70 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink">
                <LuActivity size={14} className="text-accent shrink-0" />
                链路连接指标
              </h3>
              <Badge dot={true} tone={status === 'connected' ? 'ok' : status === 'connecting' ? 'warn' : 'fail'}>
                {status === 'connected' ? '已串流连接' : status === 'connecting' ? '握手连接中' : '链路未就绪'}
              </Badge>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-ink-soft">
                <span>往返时延 (RTT)</span>
                <span className="font-mono font-medium text-ink">{latencyMs != null ? `${latencyMs} ms` : '—'}</span>
              </div>
              <div className="flex items-center justify-between text-ink-soft">
                <span>视频画幅</span>
                <span className="font-mono font-medium text-ink">{videoResolution ? `${videoResolution.width} × ${videoResolution.height}` : '等待解码'}</span>
              </div>
              <div className="flex items-center justify-between text-ink-soft">
                <span>客户端环境</span>
                <span className="truncate max-w-[180px] font-medium text-ink" title={diagnostics.userAgent}>
                  {diagnostics.os} / {diagnostics.browser}
                </span>
              </div>
              <div className="flex items-center justify-between text-ink-soft">
                <span>H.264 硬件解码</span>
                <Badge dot={false} tone={diagnostics.h264Supported ? 'ok' : 'neutral'}>
                  {diagnostics.h264Supported ? '支持' : '回退/未知'}
                </Badge>
              </div>
            </div>
          </section>

          {/* 移动端调试工具箱 */}
          <section className="rounded-lg border border-accent/30 bg-accent/10 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
                <LuBug size={14} className="shrink-0" />
                移动端调试工具箱
              </h3>
              <span className="text-[10px] text-ink-soft">手机端专供</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button size="xs" variant={devToolsActive ? 'accent' : 'default'} onClick={handleToggleDevTools} className="justify-center text-xs">
                <LuTerminal size={13} className="mr-1.5 shrink-0" />
                {devToolsActive ? '手机 DevTools (开)' : '开启 DevTools'}
              </Button>
              <Button size="xs" variant={hudVisible ? 'accent' : 'default'} onClick={onToggleHud} className="justify-center text-xs">
                <LuActivity size={13} className="mr-1.5 shrink-0" />
                {hudVisible ? '性能 HUD (开)' : '显示性能 HUD'}
              </Button>
              <Button size="xs" variant="ghost" onClick={handleCopyMacCmd} className="col-span-2 justify-center text-xs">
                {copiedMacCmd ? <LuCheck size={13} className="mr-1.5 text-accent shrink-0" /> : <LuTerminal size={13} className="mr-1.5 shrink-0" />}
                {copiedMacCmd ? '已复制命令' : '复制 Mac 终端监视命令'}
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
