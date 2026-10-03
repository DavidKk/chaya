'use client'

import { Fragment, type ReactNode } from 'react'
import type { IconType } from 'react-icons'
import { IoBrowsersOutline, IoEllipse, IoExtensionPuzzleOutline, IoFolderOutline, IoLanguageOutline } from 'react-icons/io5'
import { LuAppWindow, LuHardDrive } from 'react-icons/lu'

import { useT } from '@/components/i18n/LocaleProvider'
import { Tooltip } from '@/components/sk/Tooltip/Tooltip'
import { cn } from '@/lib/utils'

import type { Status } from './types'

export type DashboardGameMetaProps = {
  status: Extract<Status, { ready: true }>
  remote: boolean
  layoutLabel: string
  win?: { width: number; height: number } | null
  online: boolean
  pending: boolean
}

function MetaItem({ icon: Icon, tip, className, children }: { icon: IconType; tip: string; className?: string; children: ReactNode }) {
  return (
    <Tooltip content={tip} touchBehavior="toggle">
      <span className={cn('inline-flex cursor-pointer items-center gap-1', className)}>
        <Icon size={13} aria-hidden className="shrink-0 opacity-80" />
        {children}
      </span>
    </Tooltip>
  )
}

function ConnectionDot({ className }: { className?: string }) {
  return <IoEllipse size={7} aria-hidden className={cn('mx-[3px] shrink-0', className)} />
}

/** 当前游戏卡片标题下的状态行：游戏（结构 / 体积）｜运行环境（壳 / 窗口 / 插件）｜数据（共享译文），连接状态靠右收尾 */
export function DashboardGameMeta({ status, remote, layoutLabel, win, online, pending }: DashboardGameMetaProps) {
  const t = useT()
  const shellText = status.hasShell ? (status.bundled ? t('dashboard.shellReady') : t('dashboard.shellInstalled')) : t('dashboard.shellMissing')
  /** 已装壳时用体积代替「已装壳」；打包游戏没有独立壳体积、体积未测完时仍显示状态 */
  const shellSize = status.hasShell && !status.bundled ? status.footprint?.shellLabel : undefined

  const game = [
    remote ? (
      <MetaItem key="path" icon={IoFolderOutline} tip={t('dashboard.metaPath')}>
        N/A
      </MetaItem>
    ) : null,
    <MetaItem key="layout" icon={IoFolderOutline} tip={t('dashboard.metaLayout')}>
      {layoutLabel}
    </MetaItem>,
    !remote && status.footprint?.contentLabel ? (
      <MetaItem key="content" icon={LuHardDrive} tip={t('dashboard.metaContent')}>
        {status.footprint.contentLabel}
      </MetaItem>
    ) : null,
  ]
  const runtime = remote
    ? []
    : [
        <MetaItem key="shell" icon={LuAppWindow} tip={shellSize ? `${shellText} · ${t('dashboard.metaShellSize')}` : t('dashboard.metaShell')}>
          {shellSize || shellText}
        </MetaItem>,
        win ? (
          <MetaItem key="window" icon={IoBrowsersOutline} tip={t('dashboard.metaWindow')}>
            {win.width}×{win.height}
          </MetaItem>
        ) : null,
        typeof status.pluginsTotal === 'number' ? (
          <MetaItem key="plugins" icon={IoExtensionPuzzleOutline} tip={t('dashboard.metaPlugins')}>
            {status.pluginsReady ?? 0}/{status.pluginsTotal}
          </MetaItem>
        ) : null,
      ]
  const data = [
    !remote && status.cache?.entries ? (
      <MetaItem key="cache" icon={IoLanguageOutline} tip={t('dashboard.metaSharedCache')}>
        {status.cache.entries.toLocaleString()}
      </MetaItem>
    ) : null,
  ]
  const groups = [game, runtime, data].map((items) => items.filter(Boolean)).filter((items) => items.length > 0)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.75rem] leading-relaxed text-ink-soft">
      {groups.map((items, index) => (
        <Fragment key={index}>
          {index > 0 ? <span aria-hidden className="h-3 w-px shrink-0 bg-line" /> : null}
          <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">{items}</span>
        </Fragment>
      ))}
      <Tooltip content={t('dashboard.metaConnection')} touchBehavior="toggle">
        <span className={cn('ml-auto inline-flex cursor-pointer items-center gap-1', online && 'text-ok')}>
          <ConnectionDot className={online ? 'text-ok' : pending ? 'animate-pulse text-warn' : 'opacity-50'} />
          {online ? t('dashboard.gameRunning') : pending ? t('dashboard.connecting') : t('dashboard.gameOffline')}
        </span>
      </Tooltip>
    </div>
  )
}
