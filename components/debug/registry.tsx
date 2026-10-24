'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type DebugRegistration = {
  id: string
  title: string
  actions: Array<{ id: string; label: string; run: () => void; disabled?: boolean; active?: boolean }>
}
const Context = createContext<{
  entries: DebugRegistration[]
  register: (entry: DebugRegistration) => () => void
} | null>(null)

export function DebugMenuProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<DebugRegistration[]>([])
  const register = useCallback((entry: DebugRegistration) => {
    setEntries((all) => {
      const index = all.findIndex((item) => item.id === entry.id)
      if (index === -1) return [...all, entry]
      if (all[index] === entry) return all
      const next = all.slice()
      next[index] = entry
      return next
    })
    return () => setEntries((all) => all.filter((item) => item.id !== entry.id))
  }, [])
  const value = useMemo(() => ({ entries, register }), [entries, register])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** Memoize registration to update labels/actions only when their dependencies change. */
export function useDebugMenuRegistration(entry: DebugRegistration) {
  const register = useContext(Context)?.register
  useEffect(() => {
    return register?.(entry)
  }, [entry, register])
}
export function useDebugMenuEntries() {
  return useContext(Context)?.entries ?? []
}
