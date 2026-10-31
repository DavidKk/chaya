import { useEffect, useRef, useState } from 'react'

import { FloatingBall, type FloatingBallRuntime } from '@/components/game-tools/FloatingBall'
import { useT } from '@/components/i18n/LocaleProvider'
import type { ToolSettings } from '@/lib/game-agent/tool-settings'

import { createRgssFloatingBallRuntime } from './floating-ball-runtime'

export function RgssFloatingShortcuts({ settings, onClose }: { settings: ToolSettings; onClose: () => void }) {
  const t = useT()
  const callbacks = useRef({ onClose, t })
  callbacks.current = { onClose, t }
  const [runtime, setRuntime] = useState<FloatingBallRuntime | null>(null)
  useEffect(() => {
    const bridge = createRgssFloatingBallRuntime(
      () => callbacks.current.onClose(),
      (key) => callbacks.current.t(key)
    )
    setRuntime(bridge.runtime)
    return bridge.dispose
  }, [])
  return runtime ? <FloatingBall shortcuts={settings.floatingBallShortcuts} runtime={runtime} /> : null
}
