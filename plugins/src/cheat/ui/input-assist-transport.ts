import type { InputAssistTransport } from '@/components/input-assistance/transport'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

import { gameRoomId } from '../../helpers/game/game-link'
import type { InputAssistanceController } from '../input-assistance/controller'
import type { AssistStatus } from '../input-assistance/runtime'

function controller(): InputAssistanceController | undefined {
  return (window as Window & { __chayaInputAssistance?: InputAssistanceController }).__chayaInputAssistance
}

/** 局内浮层：命令直达本游戏的控制器，回复异步派发，与 GameLink 的时序保持一致 */
export function createPluginInputAssistTransport(): InputAssistTransport {
  const listeners = new Set<(message: GameLinkMessage) => void>()
  const emit = (message: GameLinkMessage) => {
    queueMicrotask(() => {
      for (const listener of listeners) listener(message)
    })
  }
  return {
    roomId: gameRoomId(),
    connected: true,
    negotiating: false,
    localGlobal: true,
    send(message) {
      const target = controller()
      if (!target) throw new Error('键鼠工具运行时未就绪，请重新加载插件')
      target.request(message, emit)
    },
    subscribeMessages(handler) {
      listeners.add(handler)
      const onStatus = (event: Event) => handler({ type: 'assist.status', status: (event as CustomEvent<AssistStatus>).detail })
      window.addEventListener('chaya:input-assistance-status', onStatus)
      return () => {
        listeners.delete(handler)
        window.removeEventListener('chaya:input-assistance-status', onStatus)
      }
    },
  }
}
