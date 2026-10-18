'use client'

import { createContext, type ReactNode, type RefCallback, useContext, useState } from 'react'
import { createPortal } from 'react-dom'

import { panelHeadEnd } from '@/components/layoutClasses'
import { cn } from '@/lib/utils'

const StartSetterContext = createContext<RefCallback<HTMLDivElement> | null>(null)
const StartNodeContext = createContext<HTMLElement | null>(null)
const EndSetterContext = createContext<RefCallback<HTMLDivElement> | null>(null)
const EndNodeContext = createContext<HTMLElement | null>(null)

/**
 * 页头左右注入槽：壳挂 `PanelHeadStartHost` / `PanelHeadEndHost`，内容页用
 * `PanelHeadStart` / `PanelHeadEnd` portal。同页自管 head 时可直接写控件，不必走 portal。
 */
export function PanelHeadEndProvider({ children }: { children: ReactNode }) {
  const [start, setStart] = useState<HTMLElement | null>(null)
  const [end, setEnd] = useState<HTMLElement | null>(null)
  const startRef: RefCallback<HTMLDivElement> = (node) => setStart(node)
  const endRef: RefCallback<HTMLDivElement> = (node) => setEnd(node)
  return (
    <StartSetterContext.Provider value={startRef}>
      <StartNodeContext.Provider value={start}>
        <EndSetterContext.Provider value={endRef}>
          <EndNodeContext.Provider value={end}>{children}</EndNodeContext.Provider>
        </EndSetterContext.Provider>
      </StartNodeContext.Provider>
    </StartSetterContext.Provider>
  )
}

/** 放在 `panelHead` 内标题左侧（返回等） */
export function PanelHeadStartHost({ className }: { className?: string }) {
  const setHost = useContext(StartSetterContext)
  if (!setHost) throw new Error('PanelHeadStartHost must be used under PanelHeadEndProvider')
  return <div ref={setHost} className={cn('inline-flex shrink-0 items-center gap-1', className)} />
}

/** 内容页把控件注入页头标题左侧 */
export function PanelHeadStart({ children }: { children: ReactNode }) {
  const host = useContext(StartNodeContext)
  if (!host) return null
  return createPortal(children, host)
}

/** 放在 `panelHead` 内右侧；layout 壳持久挂载，切 tab 不丢 */
export function PanelHeadEndHost({ className }: { className?: string }) {
  const setHost = useContext(EndSetterContext)
  if (!setHost) throw new Error('PanelHeadEndHost must be used under PanelHeadEndProvider')
  return <div ref={setHost} className={cn(panelHeadEnd, className)} />
}

/** 内容页把筛选控件注入页头右侧（与日志 / GameEdit 的 head-end 同一视觉位） */
export function PanelHeadEnd({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const host = useContext(EndNodeContext)
  if (!host) return fallback ? <>{fallback}</> : null
  return createPortal(children, host)
}
