'use client'

import React, { useState } from 'react'
import { LuCoins, LuFootprints, LuGauge, LuHeart, LuMonitor, LuSave, LuShield, LuSlidersHorizontal, LuSwords, LuX, LuZap } from 'react-icons/lu'

import type { GameEditCmd, GameLinkMessage } from '@/lib/runtime/game-link-protocol'

type RemoteCheatDrawerProps = {
  open: boolean
  onClose: () => void
  onSend: (msg: GameLinkMessage) => void
  gameId: string
}

function generateCmdId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function generateSaveReqId(): string {
  return `save_${Date.now()}`
}

export function RemoteCheatDrawer({ open, onClose, onSend, gameId }: RemoteCheatDrawerProps) {
  const [godMode, setGodMode] = useState(false)
  const [throughWalls, setThroughWalls] = useState(false)
  const [autoWin, setAutoWin] = useState(false)
  const [gameSpeed, setGameSpeed] = useState<number>(1)
  const [feedback, setFeedback] = useState<string | null>(null)

  const showFeedback = (text: string) => {
    setFeedback(text)
    setTimeout(() => setFeedback(null), 1800)
  }

  const sendCmd = (op: Record<string, unknown>) => {
    const cmdId = generateCmdId()
    onSend({
      type: 'edit.cmd',
      cmdId,
      ...op,
    } as GameEditCmd)
  }

  const handleAddGold = (amount: number) => {
    sendCmd({ op: 'gold', value: amount })
    showFeedback(`已发送增加金币: +${amount}`)
  }

  const handleMaxGold = () => {
    sendCmd({ op: 'gold', value: 9999999 })
    showFeedback('已将金币拉满: 9,999,999')
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
    sendCmd({ op: 'runFlag', key: 'throughWalls', value: next })
    showFeedback(next ? '已开启穿墙模式' : '已关闭穿墙模式')
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
    // Revive and recover all actors 1..10
    for (let id = 1; id <= 8; id++) {
      sendCmd({ op: 'actorRevive', actorId: id })
      sendCmd({ op: 'actorRecover', actorId: id })
    }
    showFeedback('全员满血满蓝复活')
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

  const handleTogglePcUi = () => {
    onSend({ type: 'overlay.open', open: true })
    showFeedback('已请求在电脑端弹出插件面板')
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="relative flex h-full w-full max-w-sm flex-col border-l border-neutral-700/60 bg-neutral-900/95 p-5 text-neutral-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center space-x-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <LuZap size={16} />
            </div>
            <h2 className="text-base font-bold text-white">Chaya 局内控制台 (远程修改)</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white"
            aria-label="关闭"
          >
            <LuX size={18} />
          </button>
        </div>

        {/* Feedback toast */}
        {feedback && <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-3 py-2 text-center text-xs font-semibold text-emerald-300">{feedback}</div>}

        {/* Body scroll area */}
        <div className="flex-1 space-y-5 overflow-y-auto pt-4 pb-6">
          {/* 金币 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">金钱修改</h3>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleAddGold(10000)}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-emerald-400 hover:bg-neutral-700 active:scale-95"
              >
                +10,000 G
              </button>
              <button
                type="button"
                onClick={() => handleAddGold(100000)}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-emerald-400 hover:bg-neutral-700 active:scale-95"
              >
                +100,000 G
              </button>
              <button
                type="button"
                onClick={handleMaxGold}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2 text-xs font-medium text-amber-400 hover:bg-neutral-700 active:scale-95"
              >
                拉满最大
              </button>
            </div>
          </section>

          {/* 队伍恢复 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">队伍生命与状态</h3>
            <button
              type="button"
              onClick={handleFullRecovery}
              className="w-full rounded-lg border border-rose-500/40 bg-rose-950/40 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 active:scale-95"
            >
              <span className="flex items-center justify-center gap-1.5">
                <LuHeart size={15} /> 全员满血满蓝 + 复活
              </span>
            </button>
          </section>

          {/* 常用开关 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">战斗与移动开关</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleToggleGod}
                className={`rounded-lg border py-2.5 text-xs font-semibold transition-colors active:scale-95 ${
                  godMode ? 'border-emerald-500 bg-emerald-600/30 text-emerald-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuShield size={14} /> 无敌锁血: {godMode ? '已开启' : '关闭'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleThrough}
                className={`rounded-lg border py-2.5 text-xs font-semibold transition-colors active:scale-95 ${
                  throughWalls ? 'border-indigo-500 bg-indigo-600/30 text-indigo-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuFootprints size={14} /> 穿墙移动: {throughWalls ? '已开启' : '关闭'}
                </span>
              </button>

              <button
                type="button"
                onClick={handleToggleAutoWin}
                className={`col-span-2 rounded-lg border py-2.5 text-xs font-semibold transition-colors active:scale-95 ${
                  autoWin ? 'border-amber-500 bg-amber-600/30 text-amber-300' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuSwords size={14} /> 遇敌必胜: {autoWin ? '已开启' : '关闭'}
                </span>
              </button>
            </div>
          </section>

          {/* 全局倍速 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">游戏倍速调节</h3>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 5].map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => handleChangeSpeed(speed)}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-colors active:scale-95 ${
                    gameSpeed === speed ? 'border-emerald-400 bg-emerald-500 text-neutral-950' : 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </section>

          {/* 快捷操作 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">快捷操作</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleQuickSave}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuSave size={14} /> 快速存档 (Slot 1)
                </span>
              </button>
              <button
                type="button"
                onClick={handleTogglePcUi}
                className="rounded-lg border border-neutral-700 bg-neutral-800/80 py-2.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 active:scale-95"
              >
                <span className="flex items-center justify-center gap-1.5">
                  <LuMonitor size={14} /> 唤出 PC 局内面板
                </span>
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 pt-3 text-center text-[11px] text-neutral-500">Chaya WebRTC Remote Play Console</div>
      </div>
    </div>
  )
}
