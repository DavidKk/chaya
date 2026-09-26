'use client'

import { createContext, type ReactNode, useContext, useState } from 'react'

type Ctx = {
  open: boolean
  setOpen: (open: boolean) => void
}

const TranslateEnginesDrawerContext = createContext<Ctx | null>(null)

/** 翻译页小屏引擎轨抽屉：SubNav 触发 + RunPane 轨共用状态 */
export function TranslateEnginesDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <TranslateEnginesDrawerContext.Provider value={{ open, setOpen }}>{children}</TranslateEnginesDrawerContext.Provider>
}

export function useTranslateEnginesDrawer(): Ctx {
  const ctx = useContext(TranslateEnginesDrawerContext)
  if (!ctx) throw new Error('useTranslateEnginesDrawer must be used under TranslateEnginesDrawerProvider')
  return ctx
}
