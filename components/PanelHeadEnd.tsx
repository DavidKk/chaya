'use client'

import { createContext, type ReactNode, type RefCallback, useContext, useState } from 'react'
import { createPortal } from 'react-dom'

import { panelHeadEnd } from '@/components/layoutClasses'
import { cn } from '@/lib/utils'

const HostSetterContext = createContext<RefCallback<HTMLDivElement> | null>(null)
const HostNodeContext = createContext<HTMLElement | null>(null)

/**
 * 页头右侧筛选槽：壳组件挂 `PanelHeadEndHost`，内容页用 `PanelHeadEnd` 注入。
 * 同页自管 head 时直接写在 `panelHeadEnd` 即可，不必走 portal。
 */
export function PanelHeadEndProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const ref: RefCallback<HTMLDivElement> = (node) => setHost(node)
  return (
    <HostSetterContext.Provider value={ref}>
      <HostNodeContext.Provider value={host}>{children}</HostNodeContext.Provider>
    </HostSetterContext.Provider>
  )
}

/** 放在 `panelHead` 内右侧；layout 壳持久挂载，切 tab 不丢 */
export function PanelHeadEndHost({ className }: { className?: string }) {
  const setHost = useContext(HostSetterContext)
  if (!setHost) throw new Error('PanelHeadEndHost must be used under PanelHeadEndProvider')
  return <div ref={setHost} className={cn(panelHeadEnd, className)} />
}

/** 内容页把筛选控件注入页头右侧（与日志 / GameEdit 的 head-end 同一视觉位） */
export function PanelHeadEnd({ children }: { children: ReactNode }) {
  const host = useContext(HostNodeContext)
  if (!host) return null
  return createPortal(children, host)
}
