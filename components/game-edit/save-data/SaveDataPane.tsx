'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IoAdd, IoCopyOutline } from 'react-icons/io5'

import { useT } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button, EmptyState, Select, Skeleton, Spinner, TextAction, TextInput, TruncateText } from '@/components/sk'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { allowedTypes, type DataPath, type DataRow, isContainerKind, pathKey, type SearchScope } from '@/lib/game/save-data'
import { cn } from '@/lib/utils'

import { lockIconBtn } from '../lock-ui'
import { resolvePortalRoot } from '../resolvePortalRoot'
import { DataList, type ListItem, type RowHandlers, useNarrow } from './DataList'
import type { RowMenuItem } from './DataRowView'
import { DataToolbar } from './DataToolbar'
import { errorText, rowName, segmentName } from './labels'
import { PinsEntry, PinsList, WherePath } from './PinsList'
import { draftStore, valueStore } from './store'
import { StructDialog, type StructRequest } from './StructDialog'
import type { SaveDataSlot } from './transport'
import { useDataActions } from './useDataActions'
import { useSaveData } from './useSaveData'

const SEARCH_DEBOUNCE_MS = 300
const crumbBtn = 'inline-flex min-w-0 max-w-[12rem] cursor-pointer border-none bg-transparent p-0 text-xs text-ink-soft hover:text-accent'

/** 修改 › 数据: level-by-level fields with live current values and separate drafts */
export function SaveDataPane({ slot, headSlot }: { slot: SaveDataSlot; headSlot?: HTMLElement | null }) {
  const t = useT()
  const notify = useNotification()
  const { transport, path, onNavigate } = slot
  const onPathGone = useCallback(() => notify.warning(t('data.pathGone')), [notify, t])
  const state = useSaveData(slot, onPathGone)
  const actions = useDataActions(transport, state)
  const { level, status, ready, pinRows, search } = state
  const meta = level.meta

  const rootRef = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(rootRef)
  const [portal, setPortal] = useState<HTMLElement | null>(null)
  useEffect(() => setPortal(resolvePortalRoot(rootRef.current)), [])
  const [request, setRequest] = useState<StructRequest | null>(null)

  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const levelKey = pathKey(path)
  const deep = path.length > 0
  const onPins = !deep && (slot.rootView ?? 'pins') === 'pins'
  useEffect(() => setQuery(''), [levelKey, onPins])
  const open = useCallback(
    (p: DataPath) => {
      setQuery('')
      onNavigate(p, { root: 'all' })
    },
    [onNavigate]
  )
  const openPins = useCallback(() => {
    setQuery('')
    onNavigate([], { root: 'pins' })
  }, [onNavigate])
  const { startSearch, stopSearch } = state
  useEffect(() => {
    if (!query.trim()) {
      stopSearch()
      return
    }
    const timer = setTimeout(() => startSearch(query.trim(), scope, onPins ? [] : undefined), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, scope, onPins, startSearch, stopSearch])

  const lockedKeys = useMemo(() => new Set((status?.locks ?? []).map((l) => pathKey(l.path))), [status?.locks])
  const userPins = useMemo(() => new Set((status?.pins ?? []).map((p) => pathKey(p.path))), [status?.pins])
  const canEdit = !!transport && ready

  const levelItems = useMemo<ListItem[]>(() => {
    if (!meta) return []
    return level.rows.map((row) => {
      const p = [...path, row.key]
      return { key: pathKey(p), path: p, ownerOid: meta.oid, row }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `path` is identified by `levelKey`
  }, [level.rows, meta, levelKey])

  const searchItems = useMemo<ListItem[]>(
    () => (search ? search.hits.map((hit) => ({ key: pathKey(hit.path), path: hit.path, ownerOid: hit.ownerOid, row: hit, where: <WherePath row={hit} onOpen={open} /> })) : []),
    [search, open]
  )

  const { struct, copyPath, togglePin, setLock, applyDrafts, readFull } = actions
  const menu = useCallback(
    (rowPath: DataPath, row: DataRow, rowOwner: number): RowMenuItem[] => {
      const name = rowName(t, row)
      const key = pathKey(rowPath)
      const pinned = userPins.has(key)
      const items: RowMenuItem[] = [
        { id: 'copy-path', label: t('data.copyPath'), onSelect: () => void copyPath(rowPath) },
        { id: 'pin', label: t(pinned ? 'data.unpin' : 'data.pin'), onSelect: () => void togglePin(rowPath, row.label) },
      ]
      const live = valueStore.get(key)?.cell ?? row
      if (canEdit && !row.readonly && live.kind !== 'null' && allowedTypes(live.kind, row.expectType, row.nullable !== false).includes('null')) {
        items.push({
          id: 'null',
          label: t('data.setNull'),
          onSelect: () => draftStore.set(key, { path: rowPath, ownerOid: rowOwner, type: 'null', raw: '', label: name, confirm: row.confirm, state: 'pending' }),
        })
      }
      const parent = rowPath.slice(0, -1)
      const own = meta && pathKey(parent) === levelKey ? meta : null
      if (!canEdit || !own?.canInsert || row.readonly) return items
      const ownerOid = own.oid
      const del = { title: t('data.deleteTitle', { name }), description: t('data.deleteDesc') }
      if (own.kind === 'array' && own.insertMode === 'value') {
        const index = Number(row.key)
        items.push({ id: 'insert', label: t('data.insertBefore'), onSelect: () => setRequest({ mode: 'array', path: parent, ownerOid, index }) })
        if (isContainerKind(row.kind)) {
          items.push({
            id: 'copy',
            label: t('data.copyItem'),
            onSelect: () =>
              void struct({ path: parent, ownerOid, action: 'copy', from: index, index: index + 1 }, { title: t('data.copyTitle', { name }), description: t('data.copyDesc') }),
          })
        }
        items.push({ id: 'delete', label: t('data.deleteItem'), danger: true, onSelect: () => void struct({ path: parent, ownerOid, action: 'remove', index }, del) })
      } else if (own.insertMode !== 'value' || !isContainerKind(live.kind)) {
        items.push({ id: 'delete', label: t('data.deleteItem'), danger: true, onSelect: () => void struct({ path: parent, ownerOid, action: 'removeKey', key: row.key }, del) })
      }
      return items
    },
    [t, userPins, meta, levelKey, canEdit, copyPath, togglePin, struct]
  )

  const handlers: RowHandlers = useMemo(
    () => ({
      onOpen: open,
      onApply: (key) => void applyDrafts([key]),
      onLock: (p, oid, on, label) => void setLock(p, oid, on, label),
      onReadFull: readFull,
      menu,
    }),
    [open, applyDrafts, setLock, readFull, menu]
  )

  const addRequest = (): StructRequest | null => {
    if (!meta?.canInsert || !meta.insertMode) return null
    if (meta.insertMode === 'item') return { mode: 'item', path, ownerOid: meta.oid }
    if (meta.insertMode === 'selfSwitch') return { mode: 'selfSwitch', path, ownerOid: meta.oid }
    return meta.kind === 'array' ? { mode: 'array', path, ownerOid: meta.oid, index: meta.total } : { mode: 'object', path, ownerOid: meta.oid }
  }
  const add = canEdit ? addRequest() : null

  const crumbs = (
    <nav className="flex min-h-7 min-w-0 flex-1 items-center gap-1 overflow-hidden" aria-label={t('data.breadcrumbAria')}>
      {!deep && !onPins ? (
        <TruncateText text={t('data.rootCrumb')} className="text-xs font-medium text-ink" aria-current="page" />
      ) : (
        <button type="button" className={crumbBtn} onClick={() => open([])}>
          <TruncateText text={t('data.rootCrumb')} />
        </button>
      )}
      {onPins ? (
        <span className="flex min-w-0 items-center gap-1">
          <span className="text-xs text-ink-soft">›</span>
          <TruncateText text={t('data.pinsTitle')} className="text-xs font-medium text-ink" aria-current="page" />
        </span>
      ) : null}
      {path.map((seg, i) => {
        const last = i === path.length - 1
        const label = segmentName(t, seg, meta?.labels[i], i)
        return (
          <span key={i} className="flex min-w-0 items-center gap-1">
            <span className="text-xs text-ink-soft">›</span>
            {last ? (
              <TruncateText text={label} className="text-xs font-medium text-ink" aria-current="page" />
            ) : (
              <button type="button" className={crumbBtn} onClick={() => open(path.slice(0, i + 1))}>
                <TruncateText text={label} />
              </button>
            )}
          </span>
        )
      })}
      {deep ? (
        <Tooltip content={t('data.copyPath')}>
          <button type="button" className={cn(lockIconBtn, 'ml-1.5 shrink-0')} aria-label={t('data.copyPath')} onClick={() => void copyPath(path)}>
            <IoCopyOutline size={13} aria-hidden />
          </button>
        </Tooltip>
      ) : null}
    </nav>
  )

  let body: React.ReactNode
  if (!transport) body = <EmptyState title={t('data.needLink')} message={t('data.needLinkMsg')} />
  else if (status && !ready) body = <EmptyState title={t('data.notReady')} message={t('data.notReadyMsg')} />
  else if (search) {
    const footer = search.running
      ? t('data.searchRunning', { scanned: search.scanned })
      : search.hits.length
        ? search.truncated
          ? t('data.searchTruncated', { count: search.hits.length })
          : t('data.searchDone', { count: search.hits.length })
        : t('data.searchEmpty')
    body = <DataList items={searchItems} narrow={narrow} lockedKeys={lockedKeys} canEdit={canEdit} onRange={state.onRange} footer={footer} {...handlers} />
  } else if (onPins)
    body = (
      <PinsList
        rows={pinRows}
        userPins={userPins}
        narrow={narrow}
        lockedKeys={lockedKeys}
        canEdit={canEdit}
        onUnpin={(p) => void togglePin(p)}
        onReorder={(a, b) => void actions.reorderPins(a, b)}
        {...handlers}
      />
    )
  else if (level.error) body = <EmptyState title={t('data.loadFail')} message={errorText(t, level.error.code, level.error.message)} />
  else if (!meta) body = <Skeleton className="m-3 h-40" />
  else if (!level.rows.length) body = <EmptyState title={t('data.emptyLevel')} />
  else {
    const more = level.rows.length < meta.total
    body = (
      <DataList
        items={levelItems}
        narrow={narrow}
        lockedKeys={lockedKeys}
        canEdit={canEdit}
        onRange={state.onRange}
        onEndReached={more ? state.loadMore : undefined}
        footer={more ? <Spinner size="sm" label={t('data.loadMore')} /> : null}
        lead={deep ? undefined : <PinsEntry count={pinRows.length} narrow={narrow} onOpen={openPins} />}
        {...handlers}
      />
    )
  }

  const searchBox =
    transport && ready ? (
      <div className="flex items-center gap-1.5">
        <TextInput
          search
          value={query}
          placeholder={t(onPins ? 'data.searchPhAll' : 'data.searchPh')}
          aria-label={t('data.searchAria')}
          className="w-48"
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          value={scope}
          options={[
            { value: 'all', label: t('data.scopeAll') },
            { value: 'name', label: t('data.scopeName') },
            { value: 'value', label: t('data.scopeValue') },
          ]}
          onChange={(v) => setScope(v as SearchScope)}
          aria-label={t('data.scopeAria')}
          panelWidth="content"
        />
        {search ? <TextAction onClick={() => setQuery('')}>{t('data.searchClose')}</TextAction> : null}
      </div>
    ) : null

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col" role="region" aria-label={t('data.regionAria')}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        {crumbs}
        {transport && ready ? (
          <div className="flex shrink-0 items-center gap-2">
            {add && !search && !onPins ? (
              <Button variant="ghost" onClick={() => setRequest(add)}>
                <IoAdd size={15} aria-hidden />
                {t(add.mode === 'object' ? 'data.addField' : 'data.addItem')}
              </Button>
            ) : null}
            <DataToolbar status={status} actions={actions} disabled={!canEdit} />
          </div>
        ) : null}
        {searchBox && !headSlot ? searchBox : null}
      </div>
      {body}
      {searchBox && headSlot ? createPortal(searchBox, headSlot) : null}
      <StructDialog request={request} onClose={() => setRequest(null)} struct={struct} portalContainer={portal} />
    </div>
  )
}
