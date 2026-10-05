'use client'

import type { ReactNode } from 'react'
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
  /** 浏览器（Edge）模式：拿不到本机绝对路径，只改游戏目录内的 package.json 窗口配置 */
  browserMode?: boolean
  /** 浏览器模式下尚未获得目录授权、还没读到 package.json */
  windowNeedsAuth?: boolean
  onAuthorizeWindow?: () => void
  /** 浏览器模式下展示的游戏目录名 */
  browserFolder?: string
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
  /** Omitted when plugins cannot be installed here; `supported: false` locks it to manual */
  autoUpdatePlugins?: { enabled: boolean; supported: boolean; hint?: string; onChange: (next: boolean) => void }
}

type PathAction = { label: string; tooltip: string; onClick: () => void }

/** 路径行：标题 + 说明 + 等宽输入 + 选择 / 复制按钮；只读（远程 / 浏览器）时不提交 */
function PathField({
  title,
  desc,
  value,
  placeholder,
  disabled,
  readOnly,
  onChange,
  onCommit,
  pick,
  copy,
}: {
  title: string
  desc: string
  value: string
  placeholder: string
  disabled: boolean
  readOnly: boolean
  onChange: (value: string) => void
  onCommit: () => void
  pick: PathAction & { icon: ReactNode; primary?: boolean }
  copy?: PathAction
}) {
  return (
    <div className={formField}>
      <span className={formTitle}>{title}</span>
      <span className={formDesc}>{desc}</span>
      <div className={formControl}>
        <TextInput
          fullWidth
          className={formMonoInput}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            if (!readOnly) e.currentTarget.select()
          }}
          onBlur={() => {
            if (!readOnly) onCommit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
        <Button size="icon" variant={pick.primary ? undefined : 'ghost'} disabled={disabled} aria-label={pick.label} tooltip={pick.tooltip} onClick={pick.onClick}>
          {pick.icon}
        </Button>
        {copy ? (
          <Button variant="ghost" size="icon" disabled={readOnly || !value.trim()} aria-label={copy.label} tooltip={copy.tooltip} onClick={copy.onClick}>
            <IoCopyOutline size={15} aria-hidden />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** 首页折叠区内的绑定路径与窗口设置。 */
export function DashboardSettings({
  busy,
  bundled,
  remote = false,
  browserMode = false,
  windowNeedsAuth = false,
  onAuthorizeWindow,
  browserFolder = '',
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
  autoUpdatePlugins: autoUpdate,
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
      <PathField
        title={t('settings.game')}
        desc={browserMode ? t('settings.gameHintBrowser') : gameDesc}
        value={browserMode ? browserFolder : gameValue}
        placeholder={t('settings.gamePh')}
        disabled={locked}
        readOnly={remote || browserMode}
        onChange={onGameRootChange}
        onCommit={() => {
          const next = gameRoot.trim()
          if (!next || next.replace(/\/$/, '') === boundGameRoot.replace(/\/$/, '')) return
          onBindGame(next)
        }}
        pick={{
          label: t('settings.changePath'),
          tooltip: remote ? t('settings.remoteNoPath') : t('settings.changePath'),
          icon: <IoGameControllerOutline size={17} aria-hidden />,
          primary: true,
          onClick: onChooseGame,
        }}
        copy={
          browserMode
            ? undefined
            : { label: t('settings.copyGamePath'), tooltip: remote ? t('settings.remoteNoPath') : t('settings.copyGamePath'), onClick: () => onCopyPath(gameRoot) }
        }
      />
      {browserMode ? null : (
        <PathField
          title={t('settings.shellSource')}
          desc={shellDesc}
          value={shellValue}
          placeholder={shellPlaceholder}
          disabled={locked || bundled}
          readOnly={remote}
          onChange={onShellSourceChange}
          onCommit={() => {
            const next = shellSource.trim()
            if (next !== boundShellSource) onBindShell(next)
          }}
          pick={{
            label: t('settings.pickShell'),
            tooltip: remote ? t('settings.remoteNoShell') : t('settings.pickShell'),
            icon: <LuHardDrive size={16} aria-hidden />,
            onClick: onChooseShell,
          }}
          copy={{ label: t('settings.copyShellPath'), tooltip: remote ? t('settings.remoteNoShell') : t('settings.copyShellPath'), onClick: () => onCopyPath(shellSource) }}
        />
      )}

      {autoUpdate ? (
        <div className={formFieldInline}>
          <span className={cn(formTitleInline, autoUpdate.supported && 'cursor-pointer')} onClick={() => autoUpdate.supported && autoUpdate.onChange(!autoUpdate.enabled)}>
            {t('settings.autoUpdatePlugins')}
          </span>
          <span className={formDescInline}>{autoUpdate.supported ? autoUpdate.hint || t('settings.autoUpdatePluginsDesc') : t('settings.autoUpdateManualOnly')}</span>
          <div className={formControlInline}>
            <SwitchToggle
              checked={autoUpdate.supported && autoUpdate.enabled}
              disabled={!autoUpdate.supported}
              onCheckedChange={autoUpdate.onChange}
              aria-label={t('settings.autoUpdatePlugins')}
              tooltip={
                autoUpdate.enabled ? t('settings.toggleOff', { label: t('settings.autoUpdatePlugins') }) : t('settings.toggleOn', { label: t('settings.autoUpdatePlugins') })
              }
            />
          </div>
        </div>
      ) : null}

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
        <div className={formFieldInline}>
          <span className={formTitleInline}>{t('settings.window')}</span>
          <span className={formDescInline}>{remote ? t('settings.remoteNoWindow') : windowNeedsAuth ? t('settings.windowNeedsAuth') : t('settings.noPackageJson')}</span>
          {windowNeedsAuth && onAuthorizeWindow ? (
            <div className={formControlInline}>
              <Button variant="ghost" disabled={busy} onClick={onAuthorizeWindow}>
                {t('settings.windowAuthorize')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
