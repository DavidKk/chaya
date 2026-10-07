'use client'

import { createContext, useContext } from 'react'

import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

/**
 * 键鼠工具与游戏运行时之间的通道。
 * Web 控制台由 GameLinkProvider 提供（走 GameLink）；局内浮层直接调用插件里的控制器。
 */
export type InputAssistTransport = {
  roomId: string | null
  connected: boolean
  negotiating: boolean
  /** 通用配置只存在当前环境的 localStorage（edge / 局内浮层），否则走本机服务磁盘 */
  localGlobal: boolean
  restart?: () => void
  send: (message: GameLinkMessage) => void
  subscribeMessages: (handler: (message: GameLinkMessage) => void) => () => void
}

export const InputAssistTransportContext = createContext<InputAssistTransport | null>(null)

export function useInputAssistTransport(): InputAssistTransport {
  const transport = useContext(InputAssistTransportContext)
  if (!transport) throw new Error('键鼠工具需要游戏连接或局内运行时')
  return transport
}
