'use client'

import { useRouter } from 'next/navigation'

import { GameAgentWorkspace } from './GameAgentWorkspace'
import { useGameAgentRequest } from './useGameAgentRequest'

type Props = {
  open: boolean
  onClose: () => void
}

export function GameAgentAppPanel({ open, onClose }: Props) {
  const router = useRouter()
  const { request, roomId } = useGameAgentRequest()

  return (
    <GameAgentWorkspace
      gameId={roomId || 'chaya-console'}
      open={open}
      onClose={onClose}
      onConnect={() => {
        onClose()
        router.push('/assist/agents')
      }}
      request={request}
      variant="sidebar"
    />
  )
}
