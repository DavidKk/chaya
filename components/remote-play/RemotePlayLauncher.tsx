'use client'

import { LuChevronDown, LuGamepad2, LuPlay, LuScrollText, LuSlidersHorizontal } from 'react-icons/lu'

import { BrandMark } from '@/components/BrandLogo'
import { useT } from '@/components/i18n/LocaleProvider'
import { Button, GradientButton } from '@/components/sk'

import { RemotePlayBackground } from './RemotePlayBackground'
import { type LibraryItem, MAX_RETRIES, type SessionPhase } from './useRemoteSession'

type Props = {
  phase: SessionPhase
  failureKind: 'launch' | 'connection'
  retryCount: number
  coverImage: string | null
  selectedGame: LibraryItem | null
  ready: boolean
  selecting: boolean
  onSettings: () => void
  onSelect: () => void
  onLaunch: () => void
  onCancel: () => void
  onRetry: () => void
  onLogs: () => void
}

export function RemotePlayLauncher({
  phase,
  failureKind,
  retryCount,
  coverImage,
  selectedGame,
  ready,
  selecting,
  onSettings,
  onSelect,
  onLaunch,
  onCancel,
  onRetry,
  onLogs,
}: Props) {
  const t = useT()
  if (phase === 'connected') return null
  const connecting = phase === 'connecting' || phase === 'reconnecting'
  const failed = phase === 'failed'
  const title = connecting
    ? t('play.connectingTitle')
    : phase === 'launching'
      ? t('play.launchingTitle')
      : failed
        ? t(failureKind === 'launch' ? 'play.launchFailedTitle' : 'play.connectionFailed')
        : t('play.gameSelectorTitle')
  const description = connecting
    ? phase === 'reconnecting'
      ? `${t('play.retrying')} ${retryCount}/${MAX_RETRIES}`
      : t('play.autoConnecting')
    : phase === 'launching'
      ? t('play.launchingLocalGame')
      : failed
        ? t(failureKind === 'launch' ? 'play.launchFailedDesc' : 'play.connectionFailedDesc')
        : selectedGame?.name || t('play.tapToSelect')

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 overflow-hidden bg-black/40 text-ink select-none">
      <style>{`
        @keyframes connecting-breathe {
          0%, 100% {
            opacity: 0.35;
            transform: scale(0.985);
          }
          50% {
            opacity: 1;
            transform: scale(1.015);
          }
        }
      `}</style>
      <RemotePlayBackground image={coverImage} variant="launcher" />
      <Button
        size="icon"
        aria-label={t('play.consoleTitle')}
        onClick={onSettings}
        className="fixed z-10"
        style={{ top: 'max(0.5rem, env(safe-area-inset-top))', right: 'max(0.75rem, env(safe-area-inset-right))' }}
      >
        <LuSlidersHorizontal size={16} aria-hidden />
      </Button>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="flex size-16 sm:size-20 landscape:size-[min(4.5rem,16dvh)] items-center justify-center">
          <BrandMark animated className="h-full w-full" />
        </div>
      </div>
      {phase !== 'select' && (
        <div
          className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl"
          style={{
            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
          }}
        >
          {/* Only the bottom status area reserves space; the logo stays centered. */}
          <div role="status" aria-live="polite" className="grid h-[7.25rem] grid-rows-[1.75rem_2.5rem_2rem] gap-2 text-center">
            <h1 className="sr-only">{title}</h1>
            {connecting ? (
              <div
                style={{ animation: 'connecting-breathe 2.2s ease-in-out infinite' }}
                className="flex items-center justify-center gap-1.5 font-mono text-base sm:text-lg font-black tracking-widest text-sky-400 drop-shadow-[0_0_14px_rgba(56,189,248,0.85)] select-none"
              >
                <span>CONNECTING</span>
                <span className="inline-flex tracking-normal font-sans">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </div>
            ) : phase === 'launching' ? (
              <div
                style={{ animation: 'connecting-breathe 2.2s ease-in-out infinite' }}
                className="flex items-center justify-center gap-1.5 font-mono text-base sm:text-lg font-black tracking-widest text-emerald-400 drop-shadow-[0_0_14px_rgba(52,211,153,0.85)] select-none"
              >
                <span>LAUNCHING</span>
                <span className="inline-flex tracking-normal font-sans">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-center font-mono text-base sm:text-lg font-black tracking-widest text-rose-400 drop-shadow-[0_0_12px_rgba(251,113,133,0.7)] select-none">
                <span>FAILED</span>
              </div>
            )}
            <p className="m-0 line-clamp-2 text-xs leading-5 text-ink-soft">{description}</p>
            <div className="flex h-8 items-center justify-center gap-2">
              {failed ? (
                <>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex items-center justify-center rounded-full border border-accent/60 bg-accent/15 px-4 py-1 text-xs font-medium text-accent backdrop-blur-md transition-all hover:bg-accent/25 hover:border-accent active:scale-95 cursor-pointer"
                  >
                    {t(failureKind === 'launch' ? 'play.retryLaunch' : 'play.reconnect')}
                  </button>
                  <button
                    type="button"
                    onClick={onCancel}
                    className="inline-flex items-center justify-center rounded-full border border-line/70 bg-panel/60 px-4 py-1 text-xs text-ink-soft backdrop-blur-md transition-all hover:border-line hover:bg-panel hover:text-ink active:scale-95 cursor-pointer"
                  >
                    {t('play.backToSelectGame')}
                  </button>
                  <button
                    type="button"
                    onClick={onLogs}
                    aria-label={t('play.diagLogs')}
                    className="inline-flex size-7 items-center justify-center rounded-full border border-line/70 bg-panel/60 text-ink-soft backdrop-blur-md transition-all hover:border-line hover:bg-panel hover:text-ink active:scale-95 cursor-pointer"
                  >
                    <LuScrollText size={14} aria-hidden />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onCancel}
                  className="inline-flex items-center justify-center rounded-full border border-line/70 bg-panel/60 px-5 py-1 text-xs text-ink-soft backdrop-blur-md transition-all hover:border-line hover:bg-panel hover:text-ink active:scale-95 cursor-pointer shadow-sm"
                >
                  {t(phase === 'launching' ? 'play.cancelLaunch' : 'play.cancelConnect')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {phase === 'select' && (
        <div
          className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-xl"
          style={{
            paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))',
            paddingLeft: 'max(0.625rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.625rem, env(safe-area-inset-right))',
          }}
        >
          <div className="flex items-center gap-2 rounded-[0.35rem] border border-accent/50 bg-panel/90 p-2 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--accent)_18%,transparent),0_0_18px_color-mix(in_oklab,var(--accent)_12%,transparent)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:shadow-[0_0_22px_var(--accent-glow)] motion-reduce:transition-none">
            <button
              type="button"
              disabled={!ready || selecting}
              onClick={onSelect}
              aria-haspopup="dialog"
              aria-label={`${t('play.switchGame')}: ${selectedGame?.name || t('play.tapToSelect')}`}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[0.25rem] p-1 text-left transition-colors hover:bg-white/5 active:scale-[0.99] disabled:cursor-wait disabled:opacity-50"
              title={selectedGame?.name || t('play.tapToSelect')}
            >
              <div className="relative flex h-9 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[0.2rem] bg-inset text-ink-soft">
                <LuGamepad2 size={18} aria-hidden />
                {coverImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={selectedGame?.id}
                    src={coverImage}
                    alt=""
                    className="absolute inset-0 h-full w-full bg-inset object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-semibold text-ink" title={selectedGame?.name}>
                  {selectedGame?.name || t('play.tapToSelect')}
                </span>
                {selectedGame?.running && (
                  <span className="truncate text-[10px] text-ok">{t(selectedGame.running.mode === 'cloud' ? 'play.cloudRunning' : 'play.localRunning')}</span>
                )}
              </div>
              <LuChevronDown size={14} className="shrink-0 text-ink-soft" aria-hidden />
            </button>
            <GradientButton variant="ok" size="md" disabled={!ready || selecting || !selectedGame} onClick={onLaunch} className="max-w-[45%] shrink-0 whitespace-nowrap">
              <LuPlay size={15} className="shrink-0" aria-hidden />
              <span className="truncate">{t(selectedGame?.running ? 'play.continueGame' : 'play.launchGame')}</span>
            </GradientButton>
          </div>
        </div>
      )}
    </div>
  )
}
