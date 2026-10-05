import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import type { SaveDataSlot, SaveDataTransport } from '@/components/game-edit/save-data/transport'
import type { TabId } from '@/components/game-edit/tabs'
import { type DataPath, isValidPath } from '@/lib/game/save-data'

import { createDirectTransport } from './save-data-transport'

function viewHost() {
  return window as Window & { __chayaDataView?: { path?: unknown } }
}

function initialPath(): DataPath {
  const saved = viewHost().__chayaDataView?.path
  return isValidPath(saved) ? [...saved] : []
}

/** Overlay data page: local path state (kept across reopen) + a direct transport while the tab is shown */
export function useOverlaySaveData(open: boolean, tab: TabId): SaveDataSlot {
  const [path, setPath] = useState<DataPath>(initialPath)
  const [transport, setTransport] = useState<SaveDataTransport | null>(null)
  const active = open && tab === 'data'

  useLayoutEffect(() => {
    viewHost().__chayaDataView = { path }
  }, [path])

  useEffect(() => {
    if (!active) {
      setTransport(null)
      return
    }
    const next = createDirectTransport()
    setTransport(next)
    return () => next.dispose()
  }, [active])

  const onNavigate = useCallback((next: DataPath) => setPath(next), [])

  return useMemo(() => ({ transport, path, onNavigate, surface: 'overlay' }), [transport, path, onNavigate])
}
