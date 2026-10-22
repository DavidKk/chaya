import { useEffect, useState } from 'react'

import { GameEditWorkbench } from '@/components/game-edit/GameEditWorkbench'
import { RGSS_SUPPORTED_EDIT_TABS, RGSS_SUPPORTED_RUN_FLAGS } from '@/components/game-edit/supported'
import type { TabId } from '@/components/game-edit/tabs'
import { emptySession } from '@/components/game-edit/types'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import type { GameEditCmdOp } from '@/lib/runtime/game-link-protocol'

import { onGameMessage, postToGame } from './host-bridge'

/** Presentation is shared with MV; every operation goes to Ruby, never MV globals. */
export function RgssWorkbench() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabId>('run')
  const [filter, setFilter] = useState('')
  const [onlyOwned, setOnlyOwned] = useState(false)
  const [onlyNamed, setOnlyNamed] = useState(false)
  const [session, setSession] = useState(emptySession)
  const [catalog, setCatalog] = useState<GameEditCatalog | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!RGSS_SUPPORTED_EDIT_TABS.has(tab)) {
      setTab('run')
    }
  }, [tab])
  const [error, setError] = useState('')
  useEffect(
    () =>
      onGameMessage((message) => {
        if (message.type === 'edit.state') {
          setReady(message.ready)
          setSession({ ...emptySession(), ...message.session })
        }
        if (message.type === 'edit.catalog') setCatalog(message.catalog)
        if (message.type === 'edit.ack' && !message.ok) setError(message.error || 'RGSS command failed')
      }),
    []
  )
  useEffect(() => {
    const toggle = () => setOpen((value) => !value)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.code === 'Backquote' || event.key === '`') {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        const target = event.composedPath()[0]
        if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('chaya:toggle', toggle)
    return () => {
      document.removeEventListener('chaya:toggle', toggle)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  useEffect(() => {
    if (open) {
      postToGame({ type: 'edit.subscribe' })
      postToGame({ type: 'edit.catalog.request' })
    }
  }, [open])
  const send = (op: GameEditCmdOp) => {
    setError('')
    postToGame({ type: 'edit.cmd', cmdId: crypto.randomUUID(), ...op })
  }
  if (!open) return null
  return (
    <div data-rgss-interactive className="pointer-events-auto fixed inset-y-0 right-0 flex w-full max-w-4xl flex-col bg-panel text-ink">
      <GameEditWorkbench
        tab={tab}
        setTab={setTab}
        filter={filter}
        setFilter={setFilter}
        onlyOwned={onlyOwned}
        setOnlyOwned={setOnlyOwned}
        onlyNamed={onlyNamed}
        setOnlyNamed={setOnlyNamed}
        loading={!catalog}
        error={error}
        catalog={catalog}
        session={session}
        linked={ready}
        readOnly={!ready}
        surface="overlay"
        supportedTabs={RGSS_SUPPORTED_EDIT_TABS}
        supportedFlags={RGSS_SUPPORTED_RUN_FLAGS}
        hideRunTools={true}
        hideSpeedSliders={true}
        onClose={() => setOpen(false)}
        onGoldChange={(value) => send({ op: 'gold', value })}
        onGoldLockChange={(on) => send({ op: 'goldLock', on, value: session.gold })}
        onMoveRateChange={(value) => send({ op: 'moveRate', value })}
        onGameSpeedChange={(value) => send({ op: 'gameSpeed', value })}
        onExpRateChange={(value) => send({ op: 'expRate', value })}
        onRunFlagChange={(key, value) => send({ op: 'runFlag', key, value })}
        onRunAction={(id) => send({ op: 'runAction', id })}
        onCountChange={(kind, id, value) => send({ op: 'count', kind, id, value })}
        onVarChange={(id, value) => send({ op: 'var', id, value })}
        onSwitchChange={(id, value) => send({ op: 'sw', id, value })}
        onRowLockChange={(row, on) => {
          if (row.valueType === 'var') send({ op: 'varLock', id: row.id, on, value: session.vars[row.id] ?? 0 })
          else if (row.valueType === 'sw') send({ op: 'swLock', id: row.id, on, value: session.switches[row.id] ? 1 : 0 })
          else if (row.kind) send({ op: 'countLock', kind: row.kind, id: row.id, on, value: session.counts[`${row.kind}:${row.id}`] ?? 0 })
        }}
        onActorChange={(id, patch) => send({ op: 'actor', id, patch })}
      />
    </div>
  )
}
