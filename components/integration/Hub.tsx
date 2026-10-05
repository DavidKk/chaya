'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { ScrollArea, Tooltip, TruncateText } from '@/components/sk'
import { cn } from '@/lib/utils'

/**
 * 集成子页（Skills / MCP / WebMCP）共用分栏：左半「说明」（导航 + 正文），右半「操作」（面板底）；
 * 层次靠背景深浅区分，选中项强调色浅底，不靠逐个卡片描边。
 */

/** 正文里的内容块（工具、连接信息等） */
export const hubBlock = 'flex flex-col gap-2 rounded-[0.4rem] border border-transparent bg-panel px-4 py-3'

export const hubBlockActive = 'border-[color-mix(in_oklab,var(--accent)_38%,transparent)] bg-[color-mix(in_oklab,var(--accent)_10%,var(--panel))]'

const navItemBase = cn(
  'flex size-10 shrink-0 items-center justify-center rounded-[0.35rem] border p-1 text-left no-underline md:h-auto md:w-full md:min-w-0 md:justify-start md:gap-2 md:px-2 md:py-1.5',
  'transition-[background,border-color,color] duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color-mix(in_oklab,var(--accent)_50%,transparent)]'
)
const navItemIdle = 'border-transparent text-ink-soft hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] hover:text-ink'
const navItemActive = 'border-[color-mix(in_oklab,var(--accent)_38%,transparent)] bg-[color-mix(in_oklab,var(--accent)_13%,transparent)] text-ink'

/** 左侧导航：children 为一个或多个 `HubNavSection`；窄屏收成只有图标的窄栏 */
export function HubNav({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label} className="flex min-h-0 w-14 shrink-0 flex-col border-r border-line bg-paper md:w-44">
      <ScrollArea className="min-h-0 flex-1" indicator={false}>
        <div className="flex flex-col items-center p-2 md:items-stretch">{children}</div>
      </ScrollArea>
    </nav>
  )
}

/** 导航分段：页面级入口（如「接入」）与分组列表分开；有标题时分组明确从属于该标题 */
export function HubNavSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn('flex shrink-0 flex-col', '[&+&]:mt-1.5 [&+&]:border-t [&+&]:border-line [&+&]:pt-1.5 md:[&+&]:mt-2 md:[&+&]:pt-2')}>
      {label ? <h3 className="m-0 hidden px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-ink-soft uppercase md:block">{label}</h3> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">{children}</ul>
    </section>
  )
}

type HubNavItemProps = {
  active: boolean
  icon: ReactNode
  label: ReactNode
  meta?: ReactNode
  title?: string
} & ({ href: string; onSelect?: never } | { href?: never; onSelect: () => void })

/** 左侧导航项：图标 + 标题 + 次要信息（id / 数量） */
export function HubNavItem({ active, icon, label, meta, title, href, onSelect }: HubNavItemProps) {
  const className = cn(navItemBase, active ? navItemActive : navItemIdle)
  const hint = typeof label === 'string' ? (title ? `${label}\n${title}` : label) : title
  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-[0.3rem] bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]',
          active && 'bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] text-accent'
        )}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col max-md:sr-only">
        <span className={cn('truncate text-[13px]', active ? 'font-semibold text-ink' : 'font-medium')}>{label}</span>
        {meta ? <span className="truncate font-mono text-[11px] text-ink-soft">{meta}</span> : null}
      </span>
    </>
  )
  return (
    <li>
      <Tooltip content={hint ?? ''} placement="right" touchBehavior="passthrough">
        {href ? (
          <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
            {body}
          </Link>
        ) : (
          <button type="button" aria-current={active ? 'true' : undefined} onClick={onSelect} className={cn(className, 'cursor-pointer bg-transparent')}>
            {body}
          </button>
        )}
      </Tooltip>
    </li>
  )
}

/** 正文 / 试调列头：标题 + 一行说明 + 右侧操作 */
export function HubPaneHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="m-0 flex min-w-0 text-sm font-semibold text-ink">
          <TruncateText text={title} />
        </h2>
        {description ? <TruncateText text={description} className="block text-xs text-ink-soft" /> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** 正文列：列头固定，内容纵向滚动 */
function HubPane({ header, children, className }: { header?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      {header}
      <ScrollArea className="min-h-0 flex-1" indicator="vertical">
        <div className="flex flex-col gap-3 px-4 py-4">{children}</div>
      </ScrollArea>
    </section>
  )
}

type HubLayoutProps = {
  /** 左半列头：当前导航项的标题与说明 */
  header: ReactNode
  nav: ReactNode
  /** 切换导航项时重置正文滚动 */
  contentKey: string
  children: ReactNode
  /** 右半「操作」列（面板底，仅 md 以上显示；窄屏需要的内容由页面自行放进正文） */
  aside: { header: ReactNode; children: ReactNode }
}

/** 三个集成子页的统一布局：左半「导航 + 说明」，右半「操作」 */
export function HubLayout({ header, nav, contentKey, children, aside }: HubLayoutProps) {
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col md:w-1/2 md:border-r md:border-line">
        {header}
        <div className="flex min-h-0 flex-1 flex-row">
          {nav}
          <HubPane key={contentKey}>{children}</HubPane>
        </div>
      </section>
      <HubPane className="hidden bg-panel md:flex md:w-1/2" header={aside.header}>
        {aside.children}
      </HubPane>
    </div>
  )
}
