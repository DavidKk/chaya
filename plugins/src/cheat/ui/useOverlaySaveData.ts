import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'

import type { DataRootView, SaveDataSlot, SaveDataTransport } from '@/components/game-edit/save-data/transport'
import type { TabId } from '@/components/game-edit/tabs'
import { type DataPath, isValidPath } from '@/lib/game/save-data'
import { readViewState, writeViewState } from '@/lib/view-state'

import { createDirectTransport } from './save-data-transport'

type DataView = { path: DataPath; root: DataRootView }

function viewHost() {
  return window as Window & { __chayaDataView?: { path?: unknown; root?: unknown } }
}

function initialView(): DataView {
  const saved = viewHost().__chayaDataView ?? (readViewState('data') as { path?: unknown; root?: unknown } | undefined)
  return { path: isValidPath(saved?.path) ? [...saved.path] : [], root: saved?.root === 'all' ? 'all' : 'pins' }
}

/** Overlay data page: local path state (kept across reopen) + a direct transport while the tab is shown */
export function useOverlaySaveData(open: boolean, tab: TabId): SaveDataSlot {
  const [view, setView] = useState<DataView>(initialView)
  const [transport, setTransport] = useState<SaveDataTransport | null>(null)
  const active = open && tab === 'data'

  useLayoutEffect(() => {
    viewHost().__chayaDataView = view
    writeViewState('data', view)
  }, [view])

  useEffect(() => {
    if (!active) {
      setTransport(null)
      return
    }
    const next = createDirectTransport()
    setTransport(next)
    return () => next.dispose()
  }, [active])

  const onNavigate = useCallback<SaveDataSlot['onNavigate']>((path, opts) => setView((v) => ({ path, root: opts?.root ?? v.root })), [])

  return useMemo(() => ({ transport, path: view.path, rootView: view.root, onNavigate, surface: 'overlay' }), [transport, view, onNavigate])
}
