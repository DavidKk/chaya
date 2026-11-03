'use client'

import { useState } from 'react'

/** A failed static cover stays on the slow preview path across list refreshes. */
export function InstancePreview({ libraryId, screenshotUrl, refreshKey, title }: { libraryId?: string; screenshotUrl: string; refreshKey: number; title: string }) {
  const [missingCover, setMissingCover] = useState(false)
  const cover = libraryId && !missingCover
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cover ? `/api/game/cover?gameId=${encodeURIComponent(libraryId)}&raw=1` : `${screenshotUrl}&t=${refreshKey}`}
      alt={title}
      className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
      onError={() => {
        if (cover) setMissingCover(true)
      }}
    />
  )
}
