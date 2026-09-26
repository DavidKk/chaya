'use client'

import { forwardRef, type ReactNode } from 'react'

import { Button, type ButtonProps } from '@/components/sk/Button'
import { cn } from '@/lib/utils'

export type GateButtonProps = Omit<ButtonProps, 'size'> & {
  icon: ReactNode
}

/** 页面入口按钮：图标固定靠左，文字相对整个按钮居中，两侧留白对称。 */
export const GateButton = forwardRef<HTMLButtonElement, GateButtonProps>(function GateButton({ icon, children, className, variant = 'accent', ...props }, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      variant={variant}
      size="gate"
      className={cn('relative !px-12 focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-accent', className)}
    >
      <span className="pointer-events-none absolute top-1/2 left-4 inline-flex -translate-y-1/2 items-center justify-center" aria-hidden>
        {icon}
      </span>
      <span className="inline-block text-center">{children}</span>
    </Button>
  )
})
