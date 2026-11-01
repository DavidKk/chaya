'use client'

import { useEffect, useState } from 'react'

type Props = {
  image: string | null
  variant?: 'surface' | 'launcher'
}

export function RemotePlayBackground({ image, variant = 'surface' }: Props) {
  const [layers, setLayers] = useState<{ current: string | null; previous: string | null }>({
    current: image,
    previous: null,
  })

  useEffect(() => {
    setLayers((old) => (old.current === image ? old : { current: image, previous: old.current }))
    const timer = setTimeout(() => setLayers((old) => ({ ...old, previous: null })), 800)
    return () => clearTimeout(timer)
  }, [image])

  const isSurface = variant === 'surface'

  const renderLayer = (src: string, isCurrent: boolean) => (
    <div
      key={src}
      className={`absolute inset-0 overflow-hidden ${
        isCurrent
          ? 'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700'
          : 'motion-reduce:hidden motion-safe:animate-out motion-safe:fade-out motion-safe:duration-700 motion-safe:fill-mode-forwards'
      }`}
      style={{
        transform: 'translate3d(0, 0, 0)',
        WebkitTransform: 'translate3d(0, 0, 0)',
      }}
    >
      {/* Real img element with explicit GPU compositing ensures Safari WebKit renders Gaussian blur reliably */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover select-none"
        style={{
          filter: 'blur(28px) brightness(0.75) saturate(1.15)',
          WebkitFilter: 'blur(28px) brightness(0.75) saturate(1.15)',
          transform: 'scale(1.18) translate3d(0, 0, 0)',
          WebkitTransform: 'scale(1.18) translate3d(0, 0, 0)',
          willChange: 'transform',
        }}
      />
    </div>
  )

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black select-none">
      {/* 1. Blurred cover image layers */}
      <div className={`absolute inset-0 ${isSurface ? 'opacity-75' : 'opacity-85'}`}>
        {layers.previous && renderLayer(layers.previous, false)}
        {layers.current && renderLayer(layers.current, true)}
      </div>

      {/* 2. Clean dark mask to ensure virtual controller buttons and HUD contrast nicely */}
      <div className={`absolute inset-0 ${isSurface ? 'bg-black/30' : 'bg-black/40'}`} />

      {/* 3. Subtle dark vignette (top & bottom shield for safe area and control cluster) */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/65" />
    </div>
  )
}
