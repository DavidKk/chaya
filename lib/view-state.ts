'use client'

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

const PREFIX = 'chaya:view:'

/** In-panel view state kept in sessionStorage, so a page refresh reopens the same detail instead of the list */
export function readViewState(key: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key)
    return raw == null ? undefined : (JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

export function writeViewState(key: string, value: unknown) {
  try {
    if (value === undefined) window.sessionStorage.removeItem(PREFIX + key)
    else window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* storage unavailable or full: the view just won't survive a refresh */
  }
}

/** `useState` that survives a page refresh; invalid stored values fall back to `initial` */
export function useViewState<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const saved = typeof window === 'undefined' ? undefined : readViewState(key)
    return valid(saved) ? saved : initial
  })
  useEffect(() => {
    writeViewState(key, value)
  }, [key, value])
  return [value, setValue]
}
