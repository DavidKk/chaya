'use client'

import { createContext, useContext } from 'react'

import { tNow } from '@/lib/i18n'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

/**
 * 辅助工具（键鼠工具、游戏存档）与游戏运行时之间的通道。
 * Web 控制台由 GameLinkProvider 提供（走 GameLink）；局内浮层直接调用插件里的控制器。
 */
export type GameToolTransport = {
  roomId: string | null
  connected: boolean
  negotiating: boolean
  /** 通用配置只存在当前环境的 localStorage（edge / 局内浮层），否则走本机服务磁盘 */
  localGlobal: boolean
  restart?: () => void
  send: (message: GameLinkMessage) => void
  subscribeMessages: (handler: (message: GameLinkMessage) => void) => () => void
}

export const GameToolTransportContext = createContext<GameToolTransport | null>(null)

export function useGameToolTransport(): GameToolTransport {
  const transport = useContext(GameToolTransportContext)
  if (!transport) throw new Error(tNow('saves.error.transport'))
  return transport
}
