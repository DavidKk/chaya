import { useSyncExternalStore } from 'react'

const noopSubscribe = () => () => {}

/** `window.location.origin` after hydration; `''` during SSR. */
export function usePageOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => ''
  )
}
