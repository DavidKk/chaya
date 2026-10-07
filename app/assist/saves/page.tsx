'use client'

import { useRouter } from 'next/navigation'

import { GameSavesPage } from '@/components/game-saves/GameSavesPage'

export default function GameSavesRoute() {
  const router = useRouter()
  return <GameSavesPage onOpenHotkeys={() => router.push('/assist/hotkeys')} />
}
