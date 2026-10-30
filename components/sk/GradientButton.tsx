'use client'

import { forwardRef } from 'react'

import { Button, type ButtonProps } from '@/components/sk/Button'

export type GradientButtonProps = ButtonProps

/**
 * 公共大操作渐变按钮：实心偏光亮渐变底色、发光阴影与光泽，区别于次级淡底描边小按钮。
 * 默认尺寸为大按钮（size="lg"），专用于卡片主操作与关键动作入口。
 */
export const GradientButton = forwardRef<HTMLButtonElement, GradientButtonProps>(function GradientButton({ size = 'lg', variant = 'accent', gradient = true, ...props }, ref) {
  return <Button ref={ref} size={size} variant={variant} gradient={gradient} {...props} />
})
