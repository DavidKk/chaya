'use client'

import type { ReactNode } from 'react'

import { type BindingStatusInput, BindingStatusMenu } from '@/components/BindingStatusMenu'
import { GameTitleEditor } from '@/components/GameTitleEditor'
import { cn } from '@/lib/utils'

import { DashboardGameMeta, type DashboardGameMetaProps } from './DashboardGameMeta'
import { DashboardShortcuts } from './DashboardShortcuts'

type Props = {
  title: string
  remark: string
  packageName?: string | null
  busy: boolean
  onRename: (remark: string) => void
  /** 远程会话拿不到本机状态时不传 */
  binding?: BindingStatusInput
  meta: DashboardGameMetaProps
  /** 操作区：各模式按钮可以不同；远程会话传提示文案 */
  actions: ReactNode
  /** 卡片底部补充信息（进度、下载链接等），空则不渲染 */
  notes?: ReactNode
}

/** 分段之间的分隔线与间距统一在此调整 */
function CardSection({ divided = true, className, children }: { divided?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn(divided && 'border-t border-[var(--line-soft)] pt-4', className)}>{children}</div>
}

/** 当前游戏卡片（server / Edge 共用）：头部（状态 + 标题 + 信息条）｜快捷入口｜操作区｜补充信息 */
export function DashboardGameCard({ title, remark, packageName, busy, onRename, binding, meta, actions, notes }: Props) {
  return (
    <div className="flex flex-col items-stretch gap-4 rounded-[0.4rem] border border-line bg-panel p-4">
      <CardSection divided={false} className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {binding ? <BindingStatusMenu status={binding} /> : null}
          <GameTitleEditor originalName={title} remark={remark} busy={busy} onSave={onRename} />
        </div>
        {packageName && packageName !== title ? <div className="text-[0.75rem] text-ink-soft">包名 {packageName}</div> : null}
        <DashboardGameMeta {...meta} />
      </CardSection>
      <CardSection>
        <DashboardShortcuts />
      </CardSection>
      <CardSection>{actions}</CardSection>
      {notes ? (
        <CardSection divided={false} className="flex flex-col gap-2 text-[0.75rem] leading-relaxed text-ink-soft">
          {notes}
        </CardSection>
      ) : null}
    </div>
  )
}
