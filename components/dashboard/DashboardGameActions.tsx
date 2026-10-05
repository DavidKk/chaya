'use client'

import type { ComponentProps } from 'react'
import { IoPauseOutline, IoPlayOutline } from 'react-icons/io5'
import { MdOutlineExtension, MdOutlineExtensionOff, MdOutlineUpdate } from 'react-icons/md'

import { useT } from '@/components/i18n/LocaleProvider'
import { LaunchHelp } from '@/components/LaunchHelp'
import { Button } from '@/components/sk'

import { ShellActionsMenu } from './ShellActionsMenu'
import { ShellAwaitFile } from './ShellAwaitFile'

const actionButtonClass = 'min-h-11 shrink-0 px-4 text-sm focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-accent'
type Props = {
  busy: boolean
  launch: { online: boolean; pending: boolean; enabled: boolean; label: string; tooltip?: string; onStart: () => Promise<void>; onQuit: () => Promise<void> }
  /** `outdated`: installed but not the current build; reinstalling overwrites in place */
  plugins: { state: 'missing' | 'outdated' | 'ready' | 'unavailable'; onInstall: () => Promise<unknown>; onClear: () => Promise<void> }
  shell: Omit<ComponentProps<typeof ShellActionsMenu>, 'busy' | 'gameOnline' | 'buttonClassName'>
  /** 浏览器模式：该游戏的装壳任务等待选压缩包时在此显示步骤 */
  shellTaskGameId?: string
}

/** 同一操作栏，只由宿主提供能力与动作；不区分本机版和浏览器版布局。 */
export function DashboardGameActions({ busy, launch, plugins, shell, shellTaskGameId }: Props) {
  const t = useT()
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className={actionButtonClass}
          variant={launch.online ? 'accent' : 'ok'}
          disabled={busy || (!launch.online && !launch.enabled)}
          loading={busy || launch.pending}
          tooltip={launch.tooltip}
          onClick={() => void (launch.online ? launch.onQuit() : launch.onStart())}
        >
          {launch.online ? <IoPauseOutline size={19} aria-hidden /> : <IoPlayOutline size={19} aria-hidden />}
          {launch.label}
        </Button>
        {plugins.state !== 'unavailable' ? (
          <Button
            className={actionButtonClass}
            variant={plugins.state === 'ready' ? 'fail' : 'accent'}
            disabled={busy}
            loading={busy}
            onClick={() => void (plugins.state === 'ready' ? plugins.onClear() : plugins.onInstall())}
          >
            {plugins.state === 'ready' ? (
              <MdOutlineExtensionOff size={18} aria-hidden />
            ) : plugins.state === 'outdated' ? (
              <MdOutlineUpdate size={18} aria-hidden />
            ) : (
              <MdOutlineExtension size={18} aria-hidden />
            )}
            {t(plugins.state === 'ready' ? 'gameActions.clearPlugins' : plugins.state === 'outdated' ? 'gameActions.updatePlugins' : 'gameActions.installPlugins')}
          </Button>
        ) : null}
        <ShellActionsMenu {...shell} busy={busy} gameOnline={launch.online} buttonClassName={actionButtonClass} />
      </div>
      <ShellAwaitFile gameId={shellTaskGameId} buttonClassName={actionButtonClass} />
      <LaunchHelp />
    </div>
  )
}
