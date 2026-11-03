import type { GameLinkMessage } from '@/lib/runtime/game-link-protocol'

export type RemoteWorkspaceTab = 'cheats' | 'debug' | 'logs'

export type RemoteWorkspaceProps = {
  open: boolean
  onClose: () => void
  onSend: (msg: GameLinkMessage) => void
  gameId: string
  initialTab?: RemoteWorkspaceTab
  status?: 'connecting' | 'connected' | 'disconnected'
  latencyMs?: number | null
  videoResolution?: { width: number; height: number } | null
  hudVisible?: boolean
  onToggleHud?: () => void
  isPortrait?: boolean
  autoTalk?: boolean
  onToggleAutoTalk?: () => void
}
