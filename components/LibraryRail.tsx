'use client'

import { useEffect, useMemo, useState } from 'react'
import { FaComputer } from 'react-icons/fa6'
import { IoAddOutline, IoCloseOutline, IoGameControllerOutline, IoTrashOutline } from 'react-icons/io5'
import { MdCloudQueue } from 'react-icons/md'

import { useConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button, ScrollArea, Select, TruncateText, withTooltip } from '@/components/sk'
import { controlDisabled } from '@/components/sk/control'
import type { LibraryItemView, LibrarySortMode } from '@/lib/game'
import { parseLibrarySortMode, sortLibraryEntries } from '@/lib/game/library-sort'
import { cn } from '@/lib/utils'

const SORT_STORAGE_KEY = 'chaya.librarySort'

const SORT_OPTION_KEYS = [
  { value: 'name' as const, labelKey: 'library.sortName' as const },
  { value: 'lastOpened' as const, labelKey: 'library.sortLastOpened' as const },
  { value: 'addedAt' as const, labelKey: 'library.sortAdded' as const },
]

type Props = {
  entries: LibraryItemView[]
  activeRoot: string
  busy?: boolean
  /** false 时隐藏添加 / 移除（云端形态） */
  canUseDisk?: boolean
  onSelect: (gameRoot: string) => void
  onAdd: () => void
  onRemove: (gameRoot: string) => void | Promise<void>
  /** 小屏抽屉是否打开（由父级控制） */
  mobileOpen?: boolean
  onMobileOpenChange?: (open: boolean) => void
}

function readStoredSort(): LibrarySortMode {
  if (typeof window === 'undefined') return 'name'
  try {
    return parseLibrarySortMode(window.localStorage.getItem(SORT_STORAGE_KEY), 'name')
  } catch {
    return 'name'
  }
}

export function LibraryRail({ entries, activeRoot, busy = false, canUseDisk = true, onSelect, onAdd, onRemove, mobileOpen = false, onMobileOpenChange }: Props) {
  const t = useT()
  const active = activeRoot.trim()
  const confirm = useConfirm()
  const [removing, setRemoving] = useState(false)
  const [sortMode, setSortMode] = useState<LibrarySortMode>('name')
  const sortOptions = useMemo(() => SORT_OPTION_KEYS.map((item) => ({ value: item.value, label: t(item.labelKey) })), [t])

  useEffect(() => {
    setSortMode(readStoredSort())
  }, [])

  const sorted = useMemo(() => sortLibraryEntries(entries, sortMode), [entries, sortMode])

  function closeMobile() {
    onMobileOpenChange?.(false)
  }

  function changeSort(next: string) {
    const mode = parseLibrarySortMode(next, 'name')
    setSortMode(mode)
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, mode)
    } catch {
      /* ignore quota */
    }
  }

  async function askRemove(entry: LibraryItemView) {
    if (removing) return
    const ok = await confirm({
      title: t('library.removeTitle'),
      description: t('library.removeDesc', { name: entry.remark?.trim() || entry.name }),
      confirmLabel: t('library.removeConfirm'),
      confirmVariant: 'fail',
      onConfirm: async () => {
        setRemoving(true)
        try {
          await onRemove(entry.gameRoot)
        } finally {
          setRemoving(false)
        }
      },
    })
    if (!ok) setRemoving(false)
  }

  useEffect(() => {
    if (!mobileOpen) return
    const mq = window.matchMedia('(max-width: 767px)')
    if (!mq.matches) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onMobileOpenChange?.(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen, onMobileOpenChange])

  return (
    <>
      <button
        type="button"
        className={cn('fixed inset-0 z-[65] cursor-default border-none bg-[rgb(0_0_0/0.45)] p-0 md:hidden', mobileOpen ? 'block' : 'hidden')}
        aria-label={t('library.close')}
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => closeMobile()}
      />
      <aside
        className={cn(
          'flex w-[20.5rem] flex-col min-h-0 border-r border-line bg-paper-2',
          'md:relative md:shrink-0 md:translate-x-0',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-[70] max-md:h-dvh max-md:shadow-[8px_0_28px_rgb(0_0_0/0.4)]',
          'max-md:transition-transform max-md:duration-200 max-md:ease-out',
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:pointer-events-none max-md:-translate-x-full'
        )}
        aria-label={t('library.title')}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line py-0 pr-3 pl-4">
          <span className="shrink-0 text-[0.8125rem] font-semibold tracking-[0.02em] text-ink-soft">{t('library.title')}</span>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Select
              value={sortMode}
              options={sortOptions}
              onChange={changeSort}
              disabled={busy || removing}
              aria-label={t('library.sort')}
              panelWidth="content"
              className="min-w-0 max-w-[7.5rem] [&_button]:h-8 [&_button]:min-h-8 [&_button]:px-2 [&_button]:text-[0.75rem]"
            />
            {canUseDisk ? (
              <Button variant="ghost" size="icon" disabled={busy || removing} aria-label={t('library.add')} tooltip={t('library.add')} onClick={onAdd}>
                <IoAddOutline size={18} aria-hidden />
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('common.close')} tooltip={t('common.close')} onClick={() => closeMobile()}>
              <IoCloseOutline size={16} aria-hidden />
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1" indicator="vertical" scrollProps={{ 'aria-label': t('library.listAria') }}>
          {sorted.length === 0 ? (
            <div className="px-4 py-4 text-[0.8125rem] text-ink-soft" role="status">
              {t('library.empty')}
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-3">
              {sorted.map((entry) => {
                const selected = pathEquals(entry.gameRoot, active)
                const remote = !!entry.remote
                const fingerprint = entry.missing ? undefined : entry.fingerprint
                return (
                  <li key={entry.id}>
                    <div
                      className={cn(
                        'group relative flex flex-col gap-1 rounded-[0.45rem] border border-line bg-panel px-3 pt-3 pb-2',
                        'transition-[border-color,background,box-shadow] duration-150',
                        'hover:border-[color-mix(in_oklab,var(--accent)_28%,var(--line))] hover:bg-[color-mix(in_oklab,var(--panel)_88%,var(--accent))]',
                        selected &&
                          'border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] bg-[color-mix(in_oklab,var(--accent)_12%,var(--panel))] shadow-[0_0_0_1px_color-mix(in_oklab,var(--accent)_18%,transparent)]',
                        entry.missing && 'border-[color-mix(in_oklab,var(--fail)_35%,var(--line))] bg-[color-mix(in_oklab,var(--fail)_8%,var(--panel))]',
                        remote && 'border-[color-mix(in_oklab,var(--info)_35%,var(--line))] bg-[color-mix(in_oklab,var(--info)_8%,var(--panel))]'
                      )}
                    >
                      {withTooltip(
                        remote ? t('library.remoteTag') : t('library.localTag'),
                        <span
                          className={cn('absolute top-[0.45rem] right-[0.45rem] z-[1] inline-flex text-ink-soft opacity-[0.42]', remote && 'text-info opacity-[0.55]')}
                          aria-label={remote ? t('common.remote') : t('common.local')}
                          role="img"
                        >
                          {remote ? <MdCloudQueue size={15} aria-hidden /> : <FaComputer size={14} aria-hidden />}
                        </span>
                      )}
                      <button
                        type="button"
                        className={cn(
                          'm-0 flex w-full cursor-pointer items-center gap-3 border-none bg-transparent py-0 pr-[1.35rem] pl-0 text-left text-inherit',
                          controlDisabled,
                          'focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'
                        )}
                        disabled={busy || removing || entry.missing}
                        aria-current={selected ? 'true' : undefined}
                        title={remote ? `${entry.name}（远程）` : entry.gameRoot}
                        onClick={() => {
                          onSelect(entry.gameRoot)
                          closeMobile()
                        }}
                      >
                        <span
                          className={cn(
                            'grid h-[2.15rem] w-[2.15rem] shrink-0 place-items-center rounded-[0.35rem] bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] text-ink-soft',
                            selected && 'bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-accent'
                          )}
                          aria-hidden
                        >
                          <IoGameControllerOutline size={18} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                          <TruncateText text={entry.remark?.trim() || entry.name} className="block text-[0.9rem] font-semibold tracking-[-0.01em] text-ink" />
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-ink-soft">
                            {entry.remark?.trim() ? <TruncateText text={entry.name} /> : null}
                            {entry.hasShell && !entry.missing ? <span>{t('library.shellReady')}</span> : null}
                            {fingerprint && fingerprint.engine !== 'unknown' ? (
                              <span>{fingerprint.engineVersion ? `${fingerprint.engine} ${fingerprint.engineVersion}` : fingerprint.engine}</span>
                            ) : null}
                            {fingerprint && fingerprint.pluginCount > 0 ? (
                              <span title={fingerprint.topFamilies.length ? t('library.mainPlugins', { families: fingerprint.topFamilies.join(' / ') }) : undefined}>
                                {t('library.pluginCount', { count: fingerprint.pluginCount })}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>

                      {canUseDisk ? (
                        <span className="absolute right-[0.35rem] bottom-[0.3rem] leading-none">
                          {withTooltip(
                            t('common.remove'),
                            <button
                              type="button"
                              className={cn(
                                'm-0 inline-flex h-[1.15rem] w-[1.15rem] appearance-none items-center justify-center rounded-[0.15rem] border-none bg-transparent p-0',
                                'cursor-pointer text-[color-mix(in_oklab,var(--ink-soft)_55%,transparent)] opacity-0 transition-[opacity,color] duration-100',
                                'group-hover:opacity-75 group-focus-within:opacity-75',
                                'hover:text-fail hover:opacity-100 focus-visible:text-fail focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--fail)_45%,transparent)]',
                                controlDisabled
                              )}
                              disabled={busy || removing}
                              aria-label={`移除 ${entry.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void askRemove(entry)
                              }}
                            >
                              <IoTrashOutline size={13} aria-hidden />
                            </button>,
                            busy || removing
                          )}
                        </span>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </aside>
    </>
  )
}

function pathEquals(a: string, b: string) {
  return a.replace(/\/$/, '') === b.replace(/\/$/, '')
}
