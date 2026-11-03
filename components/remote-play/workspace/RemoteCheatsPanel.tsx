'use client'

import React, { useState } from 'react'
import { LuFastForward, LuFootprints, LuHeart, LuMessageSquareText, LuRotateCw, LuSave, LuShield, LuShieldAlert, LuSun, LuSwords, LuUndo2 } from 'react-icons/lu'

import { Badge, Button, ScrollArea } from '@/components/sk'
import type { GameEditCmd } from '@/lib/runtime/game-link-protocol'

import type { RemoteWorkspaceProps } from './types'

function generateCmdId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function generateSaveReqId(): string {
  return `save_${Date.now()}`
}

export function RemoteCheatsPanel({
  onSend,
  gameId,
  isPortrait,
  autoTalk: propAutoTalk,
  onToggleAutoTalk,
}: Pick<RemoteWorkspaceProps, 'onSend' | 'gameId' | 'isPortrait' | 'autoTalk' | 'onToggleAutoTalk'>) {
  const [godMode, setGodMode] = useState(false)
  const [throughWalls, setThroughWalls] = useState(false)
  const [autoWin, setAutoWin] = useState(false)
  const [autoTalk, setAutoTalk] = useState(propAutoTalk ?? false)
  const [gameSpeed, setGameSpeed] = useState<number>(1)
  const [feedback, setFeedback] = useState<string | null>(null)

  const showFeedback = (text: string) => {
    setFeedback(text)
    setTimeout(() => {
      setFeedback((cur) => (cur === text ? null : cur))
    }, 2400)
  }

  const sendCmd = (op: Record<string, unknown>) => {
    const cmdId = generateCmdId()
    onSend({
      type: 'edit.cmd',
      cmdId,
      ...op,
    } as GameEditCmd)
  }

  const handleUnstuck = () => {
    sendCmd({ op: 'runAction', id: 'fix:unstuck' })
    showFeedback('已脱离卡死：已恢复画面亮度、解除主角隐身与移动锁定')
  }

  const handleAdvanceCutscene = () => {
    sendCmd({ op: 'runAction', id: 'fix:advanceCutscene' })
    showFeedback('已推进剧情：自动完成过场变量更新并传送回主地图')
  }

  const handleReturnPrevMap = () => {
    sendCmd({ op: 'runAction', id: 'fix:returnPrevMap' })
    showFeedback('已传回上张安全地图并恢复操作')
  }

  const handleToggleGod = () => {
    const next = !godMode
    setGodMode(next)
    sendCmd({ op: 'runFlag', key: 'god', value: next })
    showFeedback(next ? '已开启无敌锁血' : '已关闭无敌锁血')
  }

  const handleToggleThrough = () => {
    const next = !throughWalls
    setThroughWalls(next)
    sendCmd({ op: 'runFlag', key: 'through', value: next })
    showFeedback(next ? '已开启穿墙模式' : '已关闭穿墙模式')
  }

  const handleToggleAutoTalk = () => {
    if (onToggleAutoTalk) {
      onToggleAutoTalk()
      return
    }
    const next = !autoTalk
    setAutoTalk(next)
    sendCmd({ op: 'runFlag', key: 'autotalk', value: next })
    showFeedback(next ? '已开启自动对话' : '已关闭自动对话')
  }

  const handleToggleAutoWin = () => {
    const next = !autoWin
    setAutoWin(next)
    sendCmd({ op: 'runFlag', key: 'autoWin', value: next })
    showFeedback(next ? '已开启遇敌必胜' : '已关闭遇敌必胜')
  }

  const handleChangeSpeed = (speed: number) => {
    setGameSpeed(speed)
    sendCmd({ op: 'gameSpeed', value: speed })
    showFeedback(`游戏倍速已设为: ${speed}x`)
  }

  const handleFullRecovery = () => {
    for (let id = 1; id <= 8; id++) {
      sendCmd({ op: 'actorRevive', actorId: id })
      sendCmd({ op: 'actorRecover', actorId: id })
    }
    showFeedback('全员满血满蓝复活')
  }

  const handleAddGold = (amount: number) => {
    sendCmd({ op: 'gold', value: amount })
    showFeedback(`已发送增加金币: +${amount}`)
  }

  const handleQuickSave = () => {
    const reqId = generateSaveReqId()
    onSend({
      type: 'saves.cmd',
      reqId,
      gameId,
      target: 'quick',
      op: 'save',
      slot: 1,
    })
    showFeedback('已请求快速存档到 1 号槽')
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
          {/* 卡死急救与剧情推进 */}
          <section className="rounded-lg border border-fail/30 bg-fail/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fail">
                <LuShieldAlert size={14} className="shrink-0" />
                卡死急救与剧情推进
              </h3>
              <span className="text-[10px] text-ink-soft">黑屏/隐形/过场卡死</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="xs" variant="fail" onClick={handleUnstuck} className="justify-center text-xs">
                <LuSun size={13} className="mr-1.5 shrink-0" />
                脱离卡死
              </Button>
              <Button size="xs" variant="default" onClick={handleAdvanceCutscene} className="justify-center text-xs">
                <LuFastForward size={13} className="mr-1.5 shrink-0" />
                推进/跳过剧情
              </Button>
              <Button size="xs" variant="ghost" onClick={handleReturnPrevMap} className="col-span-2 justify-center text-xs">
                <LuUndo2 size={13} className="mr-1.5 shrink-0" />
                返回上张安全地图
              </Button>
            </div>
          </section>

          {/* 状态与移动 */}
          <section className="rounded-lg border border-line bg-paper-1/70 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink">
                <LuShield size={14} className="text-accent shrink-0" />
                状态与交互
              </h3>
              <span className="text-[10px] text-ink-soft">即时生效</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="xs" variant={godMode ? 'accent' : 'default'} onClick={handleToggleGod} className="justify-center text-xs">
                <LuShield size={13} className="mr-1.5 shrink-0" />
                {godMode ? '无敌锁定 (开)' : '无敌锁定 (关)'}
              </Button>
              <Button size="xs" variant={throughWalls ? 'accent' : 'default'} onClick={handleToggleThrough} className="justify-center text-xs">
                <LuFootprints size={13} className="mr-1.5 shrink-0" />
                {throughWalls ? '穿墙模式 (开)' : '穿墙模式 (关)'}
              </Button>
              <Button size="xs" variant={autoWin ? 'accent' : 'default'} onClick={handleToggleAutoWin} className="justify-center text-xs">
                <LuSwords size={13} className="mr-1.5 shrink-0" />
                {autoWin ? '遇敌必胜 (开)' : '遇敌必胜 (关)'}
              </Button>
              <Button size="xs" variant={autoTalk ? 'accent' : 'default'} onClick={handleToggleAutoTalk} className="justify-center text-xs">
                <LuMessageSquareText size={13} className="mr-1.5 shrink-0" />
                {autoTalk ? '自动对话 (开)' : '自动对话 (关)'}
              </Button>
            </div>
          </section>

          {/* 游戏倍速 */}
          <section className="rounded-lg border border-line bg-paper-1/70 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink">
                <LuRotateCw size={14} className="text-accent shrink-0" />
                游戏倍速
              </h3>
              <Badge dot={false} tone="neutral">
                当前 {gameSpeed}x
              </Badge>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 3, 5].map((speed) => (
                <Button
                  key={speed}
                  size="xs"
                  variant={gameSpeed === speed ? 'accent' : 'default'}
                  onClick={() => handleChangeSpeed(speed)}
                  className="justify-center text-xs font-mono"
                >
                  {speed}x
                </Button>
              ))}
            </div>
          </section>

          {/* 常用补给与存档 */}
          <section className="rounded-lg border border-line bg-paper-1/70 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="m-0 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink">
                <LuHeart size={14} className="text-fail shrink-0" />
                补给与存档
              </h3>
              <span className="text-[10px] text-ink-soft">单键操作</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button size="xs" variant="default" onClick={handleFullRecovery} className="justify-center text-xs">
                <LuHeart size={13} className="mr-1.5 text-fail shrink-0" />
                全员满血复活
              </Button>
              <Button size="xs" variant="default" onClick={handleQuickSave} className="justify-center text-xs">
                <LuSave size={13} className="mr-1.5 shrink-0" />
                快速存档 (槽 1)
              </Button>
              <Button size="xs" variant="ghost" onClick={() => handleAddGold(10000)} className="col-span-2 justify-center text-xs">
                增加金币 +10,000
              </Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
