import { useCallback, useEffect, useState } from 'react'

import { GameEditWorkbench } from '@/components/game-edit/GameEditWorkbench'
import { RGSS_SUPPORTED_EDIT_TABS, RGSS_SUPPORTED_RUN_FLAGS } from '@/components/game-edit/supported'
import { type ActorPaneId, isEditTab, mainNavIdForTab, type TabId } from '@/components/game-edit/tabs'
import { emptySession } from '@/components/game-edit/types'
import type { GameEditCatalog } from '@/lib/game/game-edit-catalog-types'
import type { GameEditCmdOp } from '@/lib/runtime/game-link-protocol'

import { onGameMessage, postToGame } from './host-bridge'

type Props = {
  open?: boolean
  onClose?: () => void
}

/** Presentation is shared with MV; every operation goes to Ruby, never MV globals. */
export function RgssWorkbench({ open: controlledOpen, onClose: controlledOnClose }: Props = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = typeof controlledOpen === 'boolean'
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setInternalOpen((current) => {
        const next = typeof value === 'function' ? value(current) : value
        if (!next) controlledOnClose?.()
        return next
      })
    },
    [controlledOnClose]
  )

  const [tab, setTabState] = useState<TabId>('run')
  const [lastEditTab, setLastEditTab] = useState<TabId>('run')
  const setTab = (next: TabId) => {
    setTabState(next)
    if (mainNavIdForTab(next) === 'edit') setLastEditTab(next)
  }
  const [actorId, setActorId] = useState<number | null>(null)
  const [actorPane, setActorPane] = useState<ActorPaneId>('actor')
  const [filter, setFilter] = useState('')
  const [onlyOwned, setOnlyOwned] = useState(false)
  const [onlyNamed, setOnlyNamed] = useState(false)
  const [session, setSession] = useState(emptySession)
  const [catalog, setCatalog] = useState<GameEditCatalog | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (isEditTab(tab) && !RGSS_SUPPORTED_EDIT_TABS.has(tab)) {
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
        if (message.type === 'edit.ack') setError(message.ok ? '' : message.error || 'RGSS command failed')
      }),
    []
  )
  useEffect(() => {
    if (isControlled) return
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
    const onEsc = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    document.addEventListener('chaya:toggle', toggle)
    document.addEventListener('chaya:esc', onEsc)
    return () => {
      document.removeEventListener('chaya:toggle', toggle)
      document.removeEventListener('chaya:esc', onEsc)
      document.removeEventListener('keydown', onKey)
    }
  }, [isControlled, setOpen])
  useEffect(() => {
    if (open) {
      postToGame({ type: 'edit.subscribe' })
      postToGame({ type: 'edit.catalog.request' })
    }
  }, [open])
  const send = (op: GameEditCmdOp) => {
    setError('')
    try {
      postToGame({ type: 'edit.cmd', cmdId: crypto.randomUUID(), ...op })
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  if (!open) return null
  return (
    <div data-rgss-interactive className="pointer-events-auto flex min-h-0 flex-1 flex-col">
      {error ? (
        <p role="alert" className="m-0 shrink-0 border-b border-line bg-inset px-3 py-2 text-xs text-fail">
          {error}
        </p>
      ) : null}
      <GameEditWorkbench
        tab={tab}
        setTab={setTab}
        lastEditTab={lastEditTab}
        actorId={actorId}
        setActorId={setActorId}
        actorPane={actorPane}
        setActorPane={setActorPane}
        filter={filter}
        setFilter={setFilter}
        onlyOwned={onlyOwned}
        setOnlyOwned={setOnlyOwned}
        onlyNamed={onlyNamed}
        setOnlyNamed={setOnlyNamed}
        loading={!catalog}
        error=""
        catalog={catalog}
        session={session}
        linked={ready}
        readOnly={!ready}
        surface="overlay"
        supportedTabs={RGSS_SUPPORTED_EDIT_TABS}
        supportedFlags={RGSS_SUPPORTED_RUN_FLAGS}
        hideRunTools={true}
        hideSpeedSliders={true}
        onClose={() => {
          setOpen(false)
          controlledOnClose?.()
        }}
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
        onActorVitalLockChange={(actorId, kind, on) => {
          const draft = session.actors[actorId]
          send({ op: 'actorVitalLock', actorId, kind, on, value: draft?.[kind] ?? 0 })
        }}
        onActorOwnedLockChange={(actorId, kind, entryId, on) => {
          const draft = session.actors[actorId]
          const owned = (kind === 'skills' ? draft?.skillIds : draft?.stateIds)?.includes(entryId) ?? false
          send({ op: 'actorOwnedLock', actorId, kind, entryId, on, owned })
        }}
      />
    </div>
  )
}
