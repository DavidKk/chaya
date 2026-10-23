'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function useSafeRouter() {
  try {
    return useRouter()
  } catch {
    return null
  }
}

export function useSafePathname() {
  try {
    return usePathname()
  } catch {
    return null
  }
}

export function useSafeSearchParams() {
  try {
    return useSearchParams()
  } catch {
    return null
  }
}
