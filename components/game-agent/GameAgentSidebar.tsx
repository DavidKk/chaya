'use client'

import { type GameAgentRequest, GameAgentWorkspace } from './GameAgentWorkspace'

type Props = {
  gameId: string
  open: boolean
  onClose: () => void
  request: GameAgentRequest
}

/** 游戏插件只提供侧栏外壳，Agent 内容与 App / Server / Edge 共用。 */
export function GameAgentSidebar(props: Props) {
  return <GameAgentWorkspace {...props} onConnect={() => window.dispatchEvent(new CustomEvent('chaya:game-settings-open'))} variant="sidebar" />
}
