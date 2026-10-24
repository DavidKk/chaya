'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useRef } from 'react'

import { useOptionalConfirm } from '@/components/confirm/ConfirmProvider'
import { useT } from '@/components/i18n/LocaleProvider'

type UnsavedChangesContextValue = {
  register: (id: string, isDirty: boolean) => void
  unregister: (id: string) => void
  isDirty: () => boolean
  confirmIfDirty: () => Promise<boolean>
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const t = useT()
  const confirm = useOptionalConfirm()
  const dirtyRegistry = useRef(new Map<string, boolean>())
  const isNavigatingRef = useRef(false)

  const isDirty = useCallback(() => {
    for (const val of dirtyRegistry.current.values()) {
      if (val) return true
    }
    return false
  }, [])

  const register = useCallback((id: string, dirty: boolean) => {
    dirtyRegistry.current.set(id, dirty)
  }, [])

  const unregister = useCallback((id: string) => {
    dirtyRegistry.current.delete(id)
  }, [])

  const confirmIfDirty = useCallback(async () => {
    if (!isDirty()) return true
    if (!confirm) return true
    const ok = await confirm({
      title: t('common.unsavedChangesTitle'),
      description: t('common.unsavedChangesDesc'),
      confirmLabel: t('common.discardAndLeave'),
      cancelLabel: t('common.stayAndEdit'),
      confirmVariant: 'warn',
    })
    return ok
  }, [confirm, isDirty, t])

  // 1. Intercept browser or window close / reload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  // 2. Intercept global anchor or sidebar navigation during capture phase
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (isNavigatingRef.current) return
      if (!isDirty()) return
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const target = e.target as HTMLElement | null
      if (!target) return

      // Only intercept external navigation triggers (links, sidebar items); form submit buttons are excluded
      const link = target.closest('a[href]') as HTMLAnchorElement | null
      const sideNavBtn = target.closest('[data-section-side-nav] button, [data-app-nav-link]') as HTMLElement | null
      const navTrigger = target.closest('[data-global-navigation]') as HTMLElement | null

      const trigger = link || sideNavBtn || navTrigger
      if (!trigger) return

      // Ignore if clicking identical anchor / current URL
      if (link && link.href) {
        try {
          const dest = new URL(link.href, window.location.href)
          if (dest.href === window.location.href) return
        } catch {
          // ignore parse error
        }
      }

      e.preventDefault()
      e.stopPropagation()

      void confirmIfDirty().then((confirmed) => {
        if (!confirmed) return
        // User confirmed discarding changes; resume navigation
        isNavigatingRef.current = true
        dirtyRegistry.current.clear()

        trigger.click()

        setTimeout(() => {
          isNavigatingRef.current = false
        }, 150)
      })
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [confirmIfDirty, isDirty])

  const value = useMemo(
    () => ({
      register,
      unregister,
      isDirty,
      confirmIfDirty,
    }),
    [register, unregister, isDirty, confirmIfDirty]
  )

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
}

export function useUnsavedChanges(dirty: boolean): { confirmIfDirty: () => Promise<boolean> } {
  const ctx = useContext(UnsavedChangesContext)
  const id = useId()
  const confirm = useOptionalConfirm()
  const t = useT()

  useEffect(() => {
    if (!ctx) return
    ctx.register(id, dirty)
    return () => ctx.unregister(id)
  }, [ctx, id, dirty])

  const confirmIfDirty = useCallback(async () => {
    if (!dirty) return true
    if (ctx) {
      return ctx.confirmIfDirty()
    }
    if (!confirm) return true
    return confirm({
      title: t('common.unsavedChangesTitle'),
      description: t('common.unsavedChangesDesc'),
      confirmLabel: t('common.discardAndLeave'),
      cancelLabel: t('common.stayAndEdit'),
      confirmVariant: 'warn',
    })
  }, [confirm, ctx, dirty, t])

  return { confirmIfDirty }
}
