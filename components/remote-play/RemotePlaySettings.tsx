'use client'

import { IoGlobeOutline, IoHandLeftOutline, IoHandRightOutline } from 'react-icons/io5'
import {
  LuActivity,
  LuCompass,
  LuGamepad2,
  LuMaximize2,
  LuMinimize2,
  LuMonitor,
  LuMousePointer2,
  LuPower,
  LuRotateCcw,
  LuScaling,
  LuScrollText,
  LuSlidersHorizontal,
  LuSmartphone,
  LuSparkles,
  LuVibrate,
  LuVolume2,
  LuVolumeX,
} from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher'
import { Button } from '@/components/sk'
import { Modal } from '@/components/sk/Modal'
import { ScrollArea } from '@/components/sk/ScrollArea'

import { ConfigRow } from './ConfigRow'
import { remoteModalSafeArea } from './GameSelectorModal'
import type { ControlMode } from './VirtualController'

export type SettingsTab = 'gamepad' | 'quick' | 'display' | 'system'
type Props = {
  open: boolean
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  onClose: () => void
  isPortrait: boolean
  controlMode: ControlMode
  onControlMode: (mode: ControlMode) => void
  hapticEnabled: boolean
  onHaptic: () => void
  controllerOpacity: number
  onOpacity: (opacity: number) => void
  onDrawer: (tab: 'cheats' | 'debug' | 'logs' | 'cheat') => void
  muted: boolean
  onMute: () => void
  fitMode: 'contain' | 'cover' | 'fill'
  onFit: () => void
  hudVisible: boolean
  onHud: () => void
  isStandalone: boolean
  isFullscreen: boolean
  onFullscreen: () => void
  isDesktop: boolean
  onClientMode: (mode: 'desktop' | 'mobile') => void
  hasGames: boolean
  selectedName?: string
  isSpectator?: boolean
  onClaimControl?: () => void
  onSelectGame: () => void
  onReload: () => void
  onQuit: () => void
}

export function RemotePlaySettings(props: Props) {
  const t = useT()
  const tabs = [
    { id: 'gamepad', label: t('play.gamepadTab'), Icon: LuGamepad2 },
    { id: 'quick', label: t('play.quickTab'), Icon: LuSparkles },
    { id: 'display', label: t('play.displayTab'), Icon: LuSlidersHorizontal },
    { id: 'system', label: t('play.systemTab'), Icon: LuRotateCcw },
  ] as const
  const modes = [
    { id: 'fixed', label: t('play.modeFixed'), Icon: LuGamepad2 },
    { id: 'dynamic', label: t('play.modeDynamic'), Icon: LuCompass },
    { id: 'single-left', label: t('play.modeSingleLeft'), Icon: IoHandLeftOutline },
    { id: 'single-right', label: t('play.modeSingleRight'), Icon: IoHandRightOutline },
    { id: 'touch', label: t('play.modeTouch'), Icon: LuMousePointer2 },
  ] as const

  return (
    <Modal
      open={props.open}
      title={t('play.consoleTitle')}
      onClose={props.onClose}
      className={remoteModalSafeArea}
      panelClassName={props.isPortrait ? 'max-w-sm' : 'max-w-2xl'}
      bodyClassName="gap-0 p-0"
      scrollBody={false}
    >
      <div
        className={`flex min-h-0 gap-2 ${props.isPortrait ? 'flex-col' : 'flex-row'}`}
        style={{ height: props.isPortrait ? 'min(420px, calc(82dvh - 4.5rem))' : 'min(260px, calc(85dvh - 4.5rem))' }}
      >
        <nav aria-label={t('play.preferencesTitle')} className={props.isPortrait ? 'mx-2 mt-2 grid shrink-0 grid-cols-4 gap-2' : 'my-2 ml-2 flex w-24 shrink-0 flex-col gap-2'}>
          {tabs.map(({ id, label, Icon }) => (
            <Button
              key={id}
              variant={props.tab === id ? 'outline-ok' : 'plain'}
              aria-pressed={props.tab === id}
              onClick={() => props.onTab(id)}
              className={props.isPortrait ? 'h-auto min-h-10 flex-col gap-1 px-1 py-2 text-[10px]' : 'justify-start px-2 text-xs'}
            >
              <Icon size={14} aria-hidden className="shrink-0" />
              <span className="truncate">{label}</span>
            </Button>
          ))}
        </nav>
        <ScrollArea className="min-h-0 flex-1" reserveGutter={false} scrollProps={{ 'aria-label': tabs.find((tab) => tab.id === props.tab)?.label }}>
          <div className="space-y-2 px-3 py-2">
            {props.tab === 'gamepad' && (
              <>
                {props.isSpectator ? (
                  <div className="space-y-2">
                    <div className="rounded-[0.25rem] border border-accent/40 bg-accent/10 p-2.5 text-xs leading-relaxed text-accent">{t('play.spectatorNotice')}</div>
                    {props.onClaimControl && (
                      <Button onClick={props.onClaimControl} variant="outline-ok" className="w-full text-xs">
                        {t('play.claimControl')}
                      </Button>
                    )}
                  </div>
                ) : null}
                <div className="text-xs font-semibold text-ink-soft">{t('play.controlModeTitle')}</div>
                <div className="flex w-full items-stretch justify-between gap-1.5 rounded-[0.25rem] border border-line bg-inset p-1.5">
                  {modes.map(({ id, label, Icon }) => {
                    const active = props.controlMode === id
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => props.onControlMode(id)}
                        className={`flex flex-1 min-w-0 aspect-square flex-col items-center justify-center gap-1 rounded-[0.2rem] border transition-all cursor-pointer p-1 ${
                          active
                            ? 'border-ok/80 bg-ok/15 text-ok shadow-sm font-semibold'
                            : 'border-line/40 bg-panel/40 text-ink-soft hover:border-line hover:bg-panel hover:text-ink'
                        }`}
                      >
                        <Icon size={17} aria-hidden className="shrink-0" />
                        <span className="w-full truncate text-center text-[10px] leading-tight select-none">{label}</span>
                      </button>
                    )
                  })}
                </div>
                <ConfigRow
                  icon={<LuVibrate size={16} />}
                  label={t('play.hapticFeedback')}
                  control={<span className={props.hapticEnabled ? 'text-ok' : 'text-ink-soft'}>{t(props.hapticEnabled ? 'play.enabled' : 'play.disabled')}</span>}
                  onClick={props.onHaptic}
                />
                <ConfigRow
                  icon={<LuSlidersHorizontal size={16} />}
                  label={t('play.controllerOpacity')}
                  control={
                    <div className="flex gap-1">
                      {[0.4, 0.65, 0.9].map((opacity) => (
                        <Button
                          key={opacity}
                          size="xs"
                          variant={opacity === props.controllerOpacity ? 'outline-ok' : 'plain'}
                          aria-pressed={opacity === props.controllerOpacity}
                          onClick={() => props.onOpacity(opacity)}
                        >
                          {Math.round(opacity * 100)}%
                        </Button>
                      ))}
                    </div>
                  }
                />
              </>
            )}
            {props.tab === 'quick' && (
              <>
                <ConfigRow icon={<LuSparkles size={16} />} label={t('play.inGameConsole')} onClick={() => props.onDrawer('cheats')} />
                <ConfigRow icon={<LuActivity size={16} />} label={t('play.workspaceStreamDebug')} onClick={() => props.onDrawer('debug')} />
                <ConfigRow icon={<LuScrollText size={16} />} label={t('play.diagLogs')} onClick={() => props.onDrawer('logs')} />
              </>
            )}
            {props.tab === 'display' && (
              <>
                <ConfigRow
                  icon={props.muted ? <LuVolumeX size={16} /> : <LuVolume2 size={16} />}
                  label={t('play.audioOutput')}
                  control={t(props.muted ? 'play.muted' : 'play.unmuted')}
                  onClick={props.onMute}
                />
                <ConfigRow
                  icon={<LuScaling size={16} />}
                  label={t('play.scalingMode')}
                  control={t(props.fitMode === 'cover' ? 'play.fitCover' : props.fitMode === 'fill' ? 'play.fitFill' : 'play.fitContain')}
                  onClick={props.onFit}
                />
                <ConfigRow icon={<LuActivity size={16} />} label={t('play.perfHud')} control={t(props.hudVisible ? 'play.shown' : 'play.hidden')} onClick={props.onHud} />
                {!props.isStandalone && (
                  <ConfigRow
                    icon={props.isFullscreen ? <LuMinimize2 size={16} /> : <LuMaximize2 size={16} />}
                    label={t('play.fullscreen')}
                    control={t(props.isFullscreen ? 'play.exitFullscreen' : 'play.iosAddHomeScreen')}
                    onClick={props.onFullscreen}
                  />
                )}
              </>
            )}
            {props.tab === 'system' && (
              <>
                <ConfigRow icon={<IoGlobeOutline size={16} />} label={t('locale.label')} control={<LocaleSwitcher className="shrink-0" />} />
                <ConfigRow
                  icon={<LuMonitor size={16} />}
                  label={t('play.platformMode')}
                  control={
                    <div className="flex gap-1">
                      <Button size="xs" aria-pressed={props.isDesktop} variant={props.isDesktop ? 'outline-ok' : 'plain'} onClick={() => props.onClientMode('desktop')}>
                        <LuMonitor size={12} />
                        {t('play.platformDesktop')}
                      </Button>
                      <Button size="xs" aria-pressed={!props.isDesktop} variant={!props.isDesktop ? 'outline-ok' : 'plain'} onClick={() => props.onClientMode('mobile')}>
                        <LuSmartphone size={12} />
                        {t('play.platformMobile')}
                      </Button>
                    </div>
                  }
                />
                {props.isDesktop && <p className="m-0 p-2 text-[10px] leading-relaxed text-ink-soft">{t('play.keyboardHints')}</p>}
                {props.hasGames && (
                  <ConfigRow
                    icon={<LuGamepad2 size={16} />}
                    label={t('play.switchGame')}
                    control={<span className="max-w-28 truncate">{props.selectedName}</span>}
                    onClick={props.onSelectGame}
                  />
                )}
                <ConfigRow icon={<LuRotateCcw size={16} />} label={t('play.clearReload')} onClick={props.onReload} />
                <ConfigRow icon={<LuPower size={16} />} label={t(props.isSpectator ? 'play.exitSpectator' : 'play.quitGame')} danger={!props.isSpectator} onClick={props.onQuit} />
              </>
            )}
          </div>
        </ScrollArea>
      </div>
    </Modal>
  )
}
