'use client'

import type { ComponentProps } from 'react'
import { IoPauseOutline, IoPlayOutline } from 'react-icons/io5'
import { MdOutlineExtension, MdOutlineExtensionOff } from 'react-icons/md'

import { useT } from '@/components/i18n/LocaleProvider'
import { LaunchHelp } from '@/components/LaunchHelp'
import { Button } from '@/components/sk'

import { ShellActionsMenu } from './ShellActionsMenu'

const actionButtonClass = 'min-h-11 shrink-0 px-4 text-sm focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-accent'
type Props = {
  busy: boolean
  launch: { online: boolean; pending: boolean; enabled: boolean; label: string; tooltip?: string; onStart: () => Promise<void>; onQuit: () => Promise<void> }
  plugins: { state: 'missing' | 'ready' | 'unavailable'; onInstall: () => Promise<void>; onClear: () => Promise<void> }
  shell: Omit<ComponentProps<typeof ShellActionsMenu>, 'busy' | 'gameOnline' | 'buttonClassName'>
}

/** 同一操作栏，只由宿主提供能力与动作；不区分本机版和浏览器版布局。 */
export function DashboardGameActions({ busy, launch, plugins, shell }: Props) {
  const t = useT()
  return (
    <div className="flex flex-col items-start gap-2 border-t border-[var(--line-soft)] pt-4">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
            variant={plugins.state === 'missing' ? 'accent' : 'fail'}
            disabled={busy}
            loading={busy}
            onClick={() => void (plugins.state === 'missing' ? plugins.onInstall() : plugins.onClear())}
          >
            {plugins.state === 'missing' ? <MdOutlineExtension size={18} aria-hidden /> : <MdOutlineExtensionOff size={18} aria-hidden />}
            {plugins.state === 'missing' ? t('gameActions.installPlugins') : t('gameActions.clearPlugins')}
          </Button>
        ) : null}
        <ShellActionsMenu {...shell} busy={busy} gameOnline={launch.online} buttonClassName={actionButtonClass} />
      </div>
      <LaunchHelp />
    </div>
  )
}
