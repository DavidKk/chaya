import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'

import { RemotePlayView } from '@/components/remote-play/RemotePlayView'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
}

export const metadata: Metadata = {
  title: 'Chaya Remote Play - 局域网串流游玩',
  description: 'RPG Maker WebRTC 局域网超低延迟串流游玩与触屏虚拟手柄控制台',
}

type Props = {
  searchParams?: Promise<{ roomId?: string; room?: string; game?: string }>
}

export default async function RemotePlayPage({ searchParams }: Props) {
  const query = searchParams ? await searchParams : {}
  const initialRoomId = query?.roomId || query?.room || query?.game || ''

  return (
    <Suspense fallback={<div className="h-screen w-screen bg-black" />}>
      <RemotePlayView initialRoomId={initialRoomId} />
    </Suspense>
  )
}
