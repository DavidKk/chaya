'use client'

import { type Dispatch, type SetStateAction, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { navigationEntryId, navigationViewKey, subscribeNavigationEntry } from '@/lib/ui/navigation-restoration'
import { readScrollSnapshot, writeScrollSnapshot } from '@/lib/ui/navigation-snapshot'

import { NavigationScope } from './NavigationScope'

/** Local view controls follow the same history entry and storage budget as scrolling. */
export function useNavigationViewState<T extends string>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const scope = useContext(NavigationScope)
  const entry = useSyncExternalStore(subscribeNavigationEntry, navigationEntryId, () => '')
  const [state, setState] = useState({ key: '', name: '', value: initial })
  const latest = useRef(state)
  latest.current = state
  useLayoutEffect(() => {
    const viewName = `${scope}:${name}`
    const key = navigationViewKey(viewName)
    if (key === state.key) return
    const saved = readScrollSnapshot(key)?.view
    const value = typeof saved === 'string' ? (saved as T) : state.name === viewName ? state.value : initial
    writeScrollSnapshot(key, { x: 0, y: 0, height: 0, view: value })
    setState({ key, name: viewName, value })
  }, [scope, name, state, initial, entry])
  const setValue: Dispatch<SetStateAction<T>> = (next) => {
    const current = latest.current
    const value = typeof next === 'function' ? next(current.value) : next
    const key = current.key || navigationViewKey(`${scope}:${name}`)
    writeScrollSnapshot(key, { x: 0, y: 0, height: 0, view: value })
    const nextState = { key, name: `${scope}:${name}`, value }
    latest.current = nextState
    setState(nextState)
  }
  return [state.value, setValue]
}

/** JSON controls use the same string protocol; validate persisted values before use. */
export function useNavigationJsonState<T>(name: string, initial: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const [raw, setRaw] = useNavigationViewState<string>(name, JSON.stringify(initial))
  const read = (text: string): T => {
    try {
      const value: unknown = JSON.parse(text)
      return valid(value) ? value : initial
    } catch {
      return initial
    }
  }
  return [read(raw), (next) => setRaw((previous) => JSON.stringify(typeof next === 'function' ? (next as (value: T) => T)(read(previous)) : next))]
}
export function useNavigationBooleanState(name: string, initial: boolean) {
  return useNavigationJsonState(name, initial, (value): value is boolean => typeof value === 'boolean')
}
