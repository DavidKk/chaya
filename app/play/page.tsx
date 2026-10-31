import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'

import { RemotePlayView } from '@/components/remote-play/RemotePlayView'
import { canUseDisk } from '@/lib/service-mode'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
}

export const metadata: Metadata = {
  title: 'Chaya Play - 远程串流游玩',
  description: 'RPG Maker WebRTC 局域网超低延迟串流游玩与触屏虚拟手柄控制台',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Chaya Play',
  },
  icons: {
    icon: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { url: '/brand/chaya-app-icon.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png' },
      { url: '/apple-touch-icon.png', sizes: '180x180' },
      { url: '/brand/chaya-app-icon.png', sizes: '512x512' },
    ],
  },
}

type Props = {
  searchParams?: Promise<{ roomId?: string; room?: string; game?: string }>
}

export default async function RemotePlayPage({ searchParams }: Props) {
  const query = searchParams ? await searchParams : {}
  let initialRoomId = query?.roomId || query?.room || query?.game || ''

  if (!initialRoomId && canUseDisk()) {
    try {
      const { loadConfig, findLibraryEntry } = await import('@/services/game')
      const config = loadConfig()
      const entry = findLibraryEntry(config.library, config.gameRoot)
      initialRoomId = entry?.id || config.library?.[0]?.id || ''
    } catch {
      /* fallback to client detection */
    }
  }

  return (
    <Suspense fallback={<div className="h-screen w-screen bg-black" />}>
      <RemotePlayView initialRoomId={initialRoomId} />
    </Suspense>
  )
}
