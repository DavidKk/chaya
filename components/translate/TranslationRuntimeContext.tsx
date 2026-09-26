'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { createTranslationFetch, installedTranslationRuntime, type TranslationRequestFn } from '@/lib/translate/runtime-api'

const localRequest: TranslationRequestFn = (request, signal) => {
  const runtime = installedTranslationRuntime()
  if (!runtime) return Promise.reject(new Error('游戏翻译插件未就绪，请更新插件后重新打开游戏'))
  return runtime.request(request, signal)
}
const TranslationRuntimeContext = createContext(createTranslationFetch(localRequest))

export function TranslationRuntimeProvider({ request, children }: { request: TranslationRequestFn; children: ReactNode }) {
  const client = useMemo(() => createTranslationFetch(request), [request])
  return <TranslationRuntimeContext.Provider value={client}>{children}</TranslationRuntimeContext.Provider>
}

export function useTranslationFetch() {
  return useContext(TranslationRuntimeContext)
}
