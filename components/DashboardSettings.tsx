'use client'

import { IoCopyOutline, IoGameControllerOutline } from 'react-icons/io5'
import { LuHardDrive } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import {
  formCard,
  formControl,
  formControlInline,
  formDesc,
  formDescInline,
  formField,
  formFieldInline,
  formMonoInput,
  formTitle,
  formTitleInline,
} from '@/components/layoutClasses'
import { Button, SizeInput, SwitchToggle, TextInput } from '@/components/sk'
import { SHELL_APP_NAME, SHELL_WIN_DIR_NAME } from '@/constants/brand'
import { DATA_DIR_NAME, SHELL_DIR_NAME } from '@/constants/path-names'
import { cn } from '@/lib/utils'

export type DashboardWindowConfig = {
  width: number
  height: number
  resizable: boolean
  fullscreen: boolean
  frame: boolean
  devtools: boolean
}

type Props = {
  busy: boolean
  bundled: boolean
  /** 远程会话：路径只读，配置不可改 */
  remote?: boolean
  /** 服务进程平台：win32 / darwin … */
  platform?: string
  gameRoot: string
  shellSource: string
  win: DashboardWindowConfig | null
  onGameRootChange: (value: string) => void
  onShellSourceChange: (value: string) => void
  onBindGame: (path: string) => void
  onBindShell: (path: string) => void
  onChooseGame: () => void
  onChooseShell: () => void
  onCopyPath: (text: string) => void
  onPatchWin: (key: keyof DashboardWindowConfig, value: DashboardWindowConfig[keyof DashboardWindowConfig], immediate?: boolean) => void
  onPatchWinSize: (size: { width: number; height: number }) => void
  boundGameRoot: string
  boundShellSource: string
}

/** 首页折叠区内的绑定路径与窗口设置。 */
export function DashboardSettings({
  busy,
  bundled,
  remote = false,
  platform,
  gameRoot,
  shellSource,
  win,
  onGameRootChange,
  onShellSourceChange,
  onBindGame,
  onBindShell,
  onChooseGame,
  onChooseShell,
  onCopyPath,
  onPatchWin,
  onPatchWinSize,
  boundGameRoot,
  boundShellSource,
}: Props) {
  const t = useT()
  const locked = busy || remote
  const winHost = platform === 'win32'
  const gameDesc = remote
    ? t('settings.gameHintRemote')
    : bundled
      ? winHost
        ? t('settings.gameHintBundledWin')
        : t('settings.gameHintBundledMac')
      : winHost
        ? t('settings.gameHintWin')
        : t('settings.gameHintMac')
  const shellDirHint = `${DATA_DIR_NAME}/${SHELL_DIR_NAME}`
  const shellDesc = remote
    ? t('settings.shellHintRemote')
    : bundled
      ? t('settings.shellHintBundled')
      : winHost
        ? t('settings.shellHintWin', { path: `${shellDirHint}/${SHELL_WIN_DIR_NAME}` })
        : t('settings.shellHintMac', { path: `${shellDirHint}/${SHELL_APP_NAME}` })
  const shellPlaceholder = winHost ? t('settings.shellPhWin') : t('settings.shellPhMac')
  const gameValue = remote ? 'N/A' : gameRoot
  const shellValue = remote ? 'N/A' : shellSource
  const winRows = [
    ['devtools', t('settings.winDevtools'), t('settings.winDevtoolsDesc')],
    ['resizable', t('settings.winResizable'), t('settings.winResizableDesc')],
    ['fullscreen', t('settings.winFullscreen'), t('settings.winFullscreenDesc')],
    ['frame', t('settings.winFrame'), t('settings.winFrameDesc')],
  ] as const

  return (
    <div className={formCard}>
      <div className={formField}>
        <span className={formTitle}>{t('settings.game')}</span>
        <span className={formDesc}>{gameDesc}</span>
        <div className={formControl}>
          <TextInput
            fullWidth
            className={formMonoInput}
            value={gameValue}
            disabled={locked}
            readOnly={remote}
            spellCheck={false}
            placeholder={t('settings.gamePh')}
            onChange={(e) => onGameRootChange(e.target.value)}
            onFocus={(e) => {
              if (!remote) e.currentTarget.select()
            }}
            onBlur={() => {
              if (remote) return
              const next = gameRoot.trim()
              if (!next) return
              const bound = boundGameRoot.replace(/\/$/, '')
              if (next.replace(/\/$/, '') === bound) return
              onBindGame(next)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          <Button
            size="icon"
            disabled={locked}
            aria-label={t('settings.changePath')}
            tooltip={remote ? t('settings.remoteNoPath') : t('settings.changePath')}
            onClick={onChooseGame}
          >
            <IoGameControllerOutline size={17} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={remote || !gameRoot.trim()}
            aria-label={t('settings.copyGamePath')}
            tooltip={remote ? t('settings.remoteNoPath') : t('settings.copyGamePath')}
            onClick={() => onCopyPath(gameRoot)}
          >
            <IoCopyOutline size={15} aria-hidden />
          </Button>
        </div>
      </div>

      <div className={formField}>
        <span className={formTitle}>{t('settings.shellSource')}</span>
        <span className={formDesc}>{shellDesc}</span>
        <div className={formControl}>
          <TextInput
            fullWidth
            className={formMonoInput}
            value={shellValue}
            disabled={locked || bundled}
            readOnly={remote}
            spellCheck={false}
            placeholder={shellPlaceholder}
            onChange={(e) => onShellSourceChange(e.target.value)}
            onFocus={(e) => {
              if (!remote) e.currentTarget.select()
            }}
            onBlur={() => {
              if (remote) return
              const next = shellSource.trim()
              if (next !== boundShellSource) onBindShell(next)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            disabled={locked || bundled}
            aria-label={t('settings.pickShell')}
            tooltip={remote ? t('settings.remoteNoShell') : t('settings.pickShell')}
            onClick={onChooseShell}
          >
            <LuHardDrive size={16} aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={remote || !shellSource.trim()}
            aria-label={t('settings.copyShellPath')}
            tooltip={remote ? t('settings.remoteNoShell') : t('settings.copyShellPath')}
            onClick={() => onCopyPath(shellSource)}
          >
            <IoCopyOutline size={15} aria-hidden />
          </Button>
        </div>
      </div>

      {win && !remote ? (
        <>
          <div className={formFieldInline}>
            <span className={formTitleInline}>{t('settings.windowSize')}</span>
            <span className={formDescInline}>{t('settings.windowSizeDesc')}</span>
            <div className={formControlInline}>
              <SizeInput
                width={win.width}
                height={win.height}
                disabled={busy}
                onWidthChange={(v) => onPatchWin('width', v)}
                onHeightChange={(v) => onPatchWin('height', v)}
                onSizeChange={onPatchWinSize}
              />
            </div>
          </div>
          {winRows.map(([key, label, description]) => (
            <div key={key} className={formFieldInline}>
              <span
                className={cn(formTitleInline, !busy && 'cursor-pointer')}
                onClick={() => {
                  if (!busy) onPatchWin(key, !win[key], true)
                }}
              >
                {label}
              </span>
              <span
                className={cn(formDescInline, !busy && 'cursor-pointer')}
                onClick={() => {
                  if (!busy) onPatchWin(key, !win[key], true)
                }}
              >
                {description}
              </span>
              <div className={formControlInline}>
                <SwitchToggle
                  checked={!!win[key]}
                  disabled={busy}
                  onCheckedChange={(next) => onPatchWin(key, next, true)}
                  aria-label={label}
                  tooltip={win[key] ? t('settings.toggleOff', { label }) : t('settings.toggleOn', { label })}
                />
              </div>
            </div>
          ))}
        </>
      ) : (
        <div className={formField}>
          <span className={formTitle}>{t('settings.window')}</span>
          <span className={formDesc}>{remote ? t('settings.remoteNoWindow') : t('settings.noPackageJson')}</span>
        </div>
      )}
    </div>
  )
}
