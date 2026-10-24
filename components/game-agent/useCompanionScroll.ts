'use client'

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

const NEAR_BOTTOM_PX = 48

export function useCompanionScroll(tab: 'chat' | 'activity', contentKey: string | number) {
  const listRef = useRef<HTMLDivElement>(null)
  const activityListRef = useRef<HTMLDivElement>(null)
  const chatStickBottomRef = useRef(true)
  const activityStickBottomRef = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const stickRefFor = useCallback((kind: 'chat' | 'activity') => (kind === 'chat' ? chatStickBottomRef : activityStickBottomRef), [])

  const isNearBottom = useCallback((element: HTMLDivElement) => element.scrollHeight - element.clientHeight - element.scrollTop <= NEAR_BOTTOM_PX, [])

  const pinScrollToBottom = useCallback((element: HTMLDivElement) => {
    element.scrollTop = element.scrollHeight
  }, [])

  const updateScrollPosition = useCallback(
    (element: HTMLDivElement, kind: 'chat' | 'activity') => {
      const nearBottom = isNearBottom(element)
      stickRefFor(kind).current = nearBottom
      if (kind === tab) setShowScrollToBottom(!nearBottom)
    },
    [isNearBottom, stickRefFor, tab]
  )

  useEffect(() => {
    const kind = tab
    const element = kind === 'chat' ? listRef.current : activityListRef.current
    if (!element) return

    const followIfStuck = () => {
      if (!stickRefFor(kind).current) {
        setShowScrollToBottom(!isNearBottom(element))
        return
      }
      pinScrollToBottom(element)
      setShowScrollToBottom(false)
    }

    followIfStuck()
    const frame = window.requestAnimationFrame(followIfStuck)
    const resize = new ResizeObserver(followIfStuck)
    resize.observe(element)
    const mutate = new MutationObserver(followIfStuck)
    mutate.observe(element, { childList: true, subtree: true, characterData: true })
    return () => {
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutate.disconnect()
    }
  }, [contentKey, isNearBottom, pinScrollToBottom, stickRefFor, tab])

  const scrollToBottom = useCallback(() => {
    const element = tab === 'chat' ? listRef.current : activityListRef.current
    if (!element) return
    stickRefFor(tab).current = true
    setShowScrollToBottom(false)
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    window.setTimeout(() => {
      if (!stickRefFor(tab).current) return
      pinScrollToBottom(element)
    }, 320)
  }, [pinScrollToBottom, stickRefFor, tab])

  return {
    listRef: listRef as RefObject<HTMLDivElement>,
    activityListRef: activityListRef as RefObject<HTMLDivElement>,
    showScrollToBottom,
    updateScrollPosition,
    scrollToBottom,
  }
}
