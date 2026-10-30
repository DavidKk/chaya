'use client'

import { useEffect } from 'react'

/** 主按钮与渐变色按钮（accent / ok / warn / fail / gate / lg）内跟随光 */
export function ButtonGlow() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduce.matches) return

    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-sheen="true"], [data-size="gate"]')
      if (!(el instanceof HTMLElement)) return
      const rect = el.getBoundingClientRect()
      el.style.setProperty('--btn-x', `${e.clientX - rect.left}px`)
      el.style.setProperty('--btn-y', `${e.clientY - rect.top}px`)
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    return () => document.removeEventListener('pointermove', onMove)
  }, [])

  return null
}
