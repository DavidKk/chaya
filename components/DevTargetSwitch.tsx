'use client'

import { Menu } from '@base-ui/react/menu'
import { useEffect, useState } from 'react'
import { IoCheckmark } from 'react-icons/io5'
import { LuZap } from 'react-icons/lu'

import { dropdownItemClass, dropdownPopupClass, dropdownTriggerClass } from '@/components/sk/dropdownMenu'
import { type DevTarget, isDevTarget } from '@/lib/service-mode/target'

const OPTIONS: readonly { value: DevTarget; label: string }[] = [
  { value: 'server', label: 'Server' },
  { value: 'edge', label: 'Edge' },
]

/** 仅 dev 构建挂载：切换整个 dev 进程的服务形态后整页刷新，服务端与界面一起换到目标形态 */
export function DevTargetSwitch() {
  const [target, setTarget] = useState<DevTarget>()

  useEffect(() => {
    fetch('/api/dev/target', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body: { target?: unknown }) => setTarget(isDevTarget(body.target) ? body.target : undefined))
      .catch(() => {})
  }, [])

  async function change(next: DevTarget) {
    if (next === target) return
    setTarget(next)
    const res = await fetch('/api/dev/target', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: next }) }).catch(() => null)
    if (res?.ok) window.location.reload()
  }

  const current = OPTIONS.find((opt) => opt.value === target)
  if (!current) return null
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="切换服务形态（dev）" className={dropdownTriggerClass}>
        <LuZap size={15} aria-hidden className="shrink-0" />
        <span className="whitespace-nowrap">{current.label}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
          <Menu.Popup aria-label="切换服务形态（dev）" className={dropdownPopupClass}>
            <Menu.RadioGroup
              value={target}
              onValueChange={(value: unknown) => {
                if (isDevTarget(value)) void change(value)
              }}
            >
              {OPTIONS.map(({ value, label }) => (
                <Menu.RadioItem key={value} value={value} closeOnClick className={dropdownItemClass}>
                  {label}
                  <Menu.RadioItemIndicator keepMounted className="inline-flex shrink-0 data-[unchecked]:invisible">
                    <IoCheckmark size={14} aria-hidden />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
