import type { GameToolTransport } from '@/components/game-tools/transport'
import type { GameSavesSnapshot, GameSavesStatus } from '@/lib/game/game-saves'
import { tNow } from '@/lib/i18n'
import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

import { gameRoomId } from '../../helpers/game/game-link'
import type { GameSavesController } from '../game-saves/controller'
import { GAME_SAVES_CHANGED_EVENT, GAME_SAVES_STATUS_EVENT } from '../game-saves/events'
import type { InputAssistanceController } from '../input-assistance/controller'
import type { AssistStatus } from '../input-assistance/runtime'

type Host = Window & { __chayaInputAssistance?: InputAssistanceController; __chayaGameSaves?: GameSavesController }

/** 局内浮层：命令按类型直达本游戏的控制器，回复异步派发，与 GameLink 的时序保持一致 */
export function createPluginGameToolTransport(): GameToolTransport {
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
      const host = window as Host
      if (message.type === 'saves.cmd') {
        if (!host.__chayaGameSaves) throw new Error(tNow('saves.error.runtimeMissing'))
        host.__chayaGameSaves.request(message, emit)
        return
      }
      if (!host.__chayaInputAssistance) throw new Error(tNow('saves.error.assistRuntimeMissing'))
      host.__chayaInputAssistance.request(message, emit)
    },
    subscribeMessages(handler) {
      listeners.add(handler)
      const gameId = gameRoomId()
      const onStatus = (event: Event) => handler({ type: 'assist.status', status: (event as CustomEvent<AssistStatus>).detail })
      const onSavesStatus = (event: Event) => handler({ type: 'saves.status', gameId, status: (event as CustomEvent<GameSavesStatus>).detail })
      const onSavesChanged = (event: Event) => handler({ type: 'saves.changed', gameId, snapshot: (event as CustomEvent<GameSavesSnapshot>).detail })
      window.addEventListener('chaya:input-assistance-status', onStatus)
      window.addEventListener(GAME_SAVES_STATUS_EVENT, onSavesStatus)
      window.addEventListener(GAME_SAVES_CHANGED_EVENT, onSavesChanged)
      return () => {
        listeners.delete(handler)
        window.removeEventListener('chaya:input-assistance-status', onStatus)
        window.removeEventListener(GAME_SAVES_STATUS_EVENT, onSavesStatus)
        window.removeEventListener(GAME_SAVES_CHANGED_EVENT, onSavesChanged)
      }
    },
  }
}
