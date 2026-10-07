import { useEffect, useState } from 'react'
import { LuSquare } from 'react-icons/lu'

import { Button } from '@/components/sk'

type Status = { running: string[]; pending: string[]; counts: Record<string, number>; error?: string; recording: boolean }

function currentStatus(): Status | null {
  return (window as Window & { __chayaInputAssistanceStatus?: Status }).__chayaInputAssistanceStatus ?? null
}

export function InputAssistanceIndicator() {
  const [status, setStatus] = useState<Status | null>(currentStatus)

  useEffect(() => {
    const update = (event: Event) => setStatus((event as CustomEvent<Status>).detail)
    window.addEventListener('chaya:input-assistance-status', update)
    setStatus(currentStatus())
    return () => window.removeEventListener('chaya:input-assistance-status', update)
  }, [])

  if (!status?.running.length) return null
  return (
    <div
      className="pointer-events-auto fixed bottom-3 left-3 z-[2147483646] inline-flex h-8 items-center gap-2 rounded-[0.2rem] border border-line bg-panel px-2 text-xs text-ink shadow-lg"
      role="status"
    >
      <span>辅助运行中 · {status.running.length}</span>
      <Button
        variant="plain"
        size="icon"
        className="h-6 w-6"
        aria-label="停止全部辅助规则"
        onClick={() => (window as Window & { __chayaInputAssistanceStopAll?: () => void }).__chayaInputAssistanceStopAll?.()}
      >
        <LuSquare size={13} />
      </Button>
    </div>
  )
}
