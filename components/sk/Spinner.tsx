'use client'

import { LuLoaderPinwheel } from 'react-icons/lu'

import { cn } from '@/lib/utils'

export type SpinnerSize = 'sm' | 'md' | 'lg'

const SIZE: Record<SpinnerSize, string> = {
  sm: 'size-[0.9rem] shrink-0 animate-spin',
  md: 'size-[1.15rem] shrink-0 animate-spin',
  lg: 'size-[1.35rem] shrink-0 animate-spin',
}

export function Spinner({ size = 'md', className, label = '加载中' }: { size?: SpinnerSize; className?: string; label?: string }) {
  return <LuLoaderPinwheel className={cn(SIZE[size], 'text-current', className)} role="status" aria-label={label} />
}
