'use client'

import { LuCheck, LuGamepad2 } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Badge } from '@/components/sk/Badge'
import { Modal } from '@/components/sk/Modal'

import type { LibraryItem } from './useRemoteSession'

export const remoteModalSafeArea =
  'pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]'

export function GameSelectorModal({
  open,
  library,
  selectedGame,
  selecting,
  onSelect,
  onClose,
}: {
  open: boolean
  library: LibraryItem[]
  selectedGame: LibraryItem | null
  selecting: boolean
  onSelect: (game: LibraryItem) => void
  onClose: () => void
}) {
  const t = useT()
  const groups = [
    { key: 'cloud', title: t('play.cloudGames'), games: library.filter((game) => game.running?.mode === 'cloud') },
    {
      key: 'local',
      title: t('play.localGames'),
      games: library.filter((game) => game.running?.mode !== 'cloud').sort((a, b) => Number(Boolean(b.running)) - Number(Boolean(a.running))),
    },
  ]
  return (
    <Modal
      open={open}
      title={t('play.gameSelectorTitle')}
      onClose={onClose}
      className={remoteModalSafeArea}
      panelClassName="max-w-2xl max-h-[min(32rem,calc(100dvh-2rem))] max-h-[560px]:landscape:max-w-3xl max-h-[560px]:landscape:max-h-[calc(100dvh-1.5rem)]"
      bodyClassName="px-2 py-2 sm:px-3 sm:py-2.5"
    >
      <style>{`
        /* Mobile landscape: single horizontal row */
        @media (orientation: landscape) and (max-height: 560px) {
          .game-selector-container {
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            gap: 0.625rem !important;
            padding: 0.25rem 0.125rem 0.5rem 0.125rem !important;
            -webkit-overflow-scrolling: touch;
          }
          .game-selector-card {
            width: 12.5rem !important;
            flex-shrink: 0 !important;
            flex-direction: column !important;
          }
          .game-selector-thumb {
            width: 100% !important;
            aspect-ratio: 16 / 9 !important;
            height: 5.5rem !important;
          }
        }

        /* Mobile portrait: compact thumb-friendly horizontal list items */
        @media (orientation: portrait) and (max-width: 767px) {
          .game-selector-container {
            display: flex !important;
            flex-direction: column !important;
            gap: 0.375rem !important;
          }
          .game-selector-card {
            flex-direction: row !important;
            align-items: center !important;
            padding: 0.375rem 0.5rem !important;
            gap: 0.5rem !important;
          }
          .game-selector-thumb {
            width: 4.75rem !important;
            aspect-ratio: 16 / 9 !important;
            height: auto !important;
            flex-shrink: 0 !important;
          }
          .game-selector-info {
            padding: 0 !important;
          }
        }
      `}</style>
      <div className="flex flex-col gap-3">
        {groups
          .filter((group) => group.games.length > 0)
          .map((group) => (
            <section key={group.key} aria-label={group.title} className="min-w-0">
              <h3 className="m-0 mb-2 flex items-center gap-2 text-xs font-medium text-ink-soft">
                {group.title}
                <span className="font-mono text-[10px]">{group.games.length}</span>
              </h3>
              <div className="game-selector-container grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3">
                {group.games.map((game) => {
                  const selected = selectedGame?.id === game.id
                  const rawKind = game.fingerprint?.engine?.name || game.kindLabel || ''
                  const engine = /www|unknown/i.test(rawKind) ? '' : rawKind
                  return (
                    <button
                      key={game.id}
                      type="button"
                      aria-pressed={selected}
                      disabled={selecting}
                      onClick={() => onSelect(game)}
                      className={`game-selector-card group flex flex-col cursor-pointer overflow-hidden rounded-[0.25rem] border text-left transition-all active:scale-[0.99] disabled:cursor-wait disabled:opacity-50 ${
                        selected
                          ? 'border-ok/90 bg-ok/10 text-ink shadow-[0_0_12px_color-mix(in_oklab,var(--ok)_15%,transparent)]'
                          : 'border-line bg-panel-2 text-ink hover:border-accent hover:bg-panel'
                      }`}
                    >
                      <div className="game-selector-thumb relative flex aspect-video max-h-28 w-full items-center justify-center overflow-hidden rounded-[0.18rem] bg-inset text-ink-soft shrink-0">
                        <LuGamepad2 size={24} aria-hidden />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/game/cover?gameId=${encodeURIComponent(game.id)}&raw=1`}
                          alt=""
                          className="absolute inset-0 h-full w-full bg-inset object-contain"
                          onError={(e) => {
                            const el = e.currentTarget
                            if (!el.src.includes('/api/remote/screenshot')) {
                              el.src = `/api/remote/screenshot?roomId=${encodeURIComponent(game.id)}`
                            } else {
                              el.style.display = 'none'
                            }
                          }}
                        />
                        {selected && (
                          <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-[0.2rem] bg-ok text-paper shadow-sm">
                            <LuCheck size={14} aria-hidden strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="game-selector-info flex w-full min-w-0 flex-1 flex-col justify-center gap-0.5 p-2.5">
                        <span className="truncate text-xs font-semibold" title={game.name}>
                          {game.name}
                        </span>
                        {engine && <span className="truncate font-mono text-[10px] text-ink-soft">{engine}</span>}
                        {game.running && (
                          <Badge size="mini" tone="ok" className="self-start">
                            {t(game.running.mode === 'cloud' ? 'play.cloudRunning' : 'play.localRunning')}
                          </Badge>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
      </div>
    </Modal>
  )
}
