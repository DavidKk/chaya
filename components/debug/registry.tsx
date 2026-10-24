'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

export type DebugRegistration = {
  id: string
  title: string
  description?: string
  actions: Array<{ id: string; label: string; run: () => void; disabled?: boolean; active?: boolean }>
  custom?: ReactNode
}

const RegisterContext = createContext<((entry: DebugRegistration) => () => void) | null>(null)
const EntriesContext = createContext<DebugRegistration[]>([])

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

  return (
    <RegisterContext.Provider value={register}>
      <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
    </RegisterContext.Provider>
  )
}

/** Memoize registration to update labels/actions only when their dependencies change. */
export function useDebugMenuRegistration(entry: DebugRegistration) {
  const register = useContext(RegisterContext)
  useEffect(() => {
    return register?.(entry)
  }, [entry, register])
}

export function useDebugMenuRegistrations(entries: DebugRegistration[]) {
  const register = useContext(RegisterContext)
  useEffect(() => {
    if (!register) return
    const unregisters = entries.map((entry) => register(entry))
    return () => {
      for (const unregister of unregisters) unregister()
    }
  }, [entries, register])
}

export function useDebugMenuEntries() {
  return useContext(EntriesContext)
}
