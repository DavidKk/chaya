'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/** Shared stick-to-bottom for log lists. Unpins when the user scrolls up; call scrollToBottom to re-pin. */
export function useFollowBottomScroll(contentKey: string | number, thresholdPx = 40) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const isNearBottom = useCallback(
    (el: HTMLDivElement) => el.scrollHeight - el.clientHeight - el.scrollTop <= thresholdPx,
    [thresholdPx]
  )

  const onScroll = useCallback(
    (el: HTMLDivElement) => {
      const near = isNearBottom(el)
      stickRef.current = near
      setShowJump(!near)
    },
    [isNearBottom]
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickRef.current) return
    el.scrollTop = el.scrollHeight
    setShowJump(false)
  }, [contentKey])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = true
    setShowJump(false)
    el.scrollTop = el.scrollHeight
  }, [])

  return {
    scrollRef: scrollRef as RefObject<HTMLDivElement | null>,
    onScroll,
    showJump,
    scrollToBottom,
  }
}
