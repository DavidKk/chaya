'use client'

import { Popover } from '@base-ui/react/popover'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import type { IconType } from 'react-icons'
import { LuBookOpen, LuCamera, LuCheck, LuCompass, LuCrown, LuFlame, LuHeart, LuMoon, LuShield, LuSparkles, LuSword, LuUpload, LuWand } from 'react-icons/lu'

import { useLocaleCode } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'
import type { CompanionGender } from '@/lib/game-agent/roles'
import { cn } from '@/lib/utils'

export type AvatarPreset = {
  id: string
  label: string
  bg: string
  icon: IconType
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'rin', label: 'Rin（烈焰）', bg: 'from-amber-500/25 to-rose-500/25 border-amber-500/40 text-amber-300', icon: LuFlame },
  { id: 'nagi', label: 'Nagi（灵动）', bg: 'from-indigo-500/25 to-sky-500/25 border-indigo-500/40 text-indigo-300', icon: LuSparkles },
  { id: 'rei', label: 'Rei（守护）', bg: 'from-cyan-500/25 to-blue-500/25 border-cyan-500/40 text-cyan-300', icon: LuShield },
  { id: 'koto', label: 'Koto（贤者）', bg: 'from-emerald-500/25 to-teal-500/25 border-emerald-500/40 text-emerald-300', icon: LuBookOpen },
  { id: 'yui', label: 'Yui（纯真）', bg: 'from-rose-500/25 to-pink-500/25 border-rose-500/40 text-rose-300', icon: LuHeart },
  { id: 'towa', label: 'Towa（星辰）', bg: 'from-purple-500/25 to-indigo-500/25 border-purple-500/40 text-purple-300', icon: LuMoon },
  { id: 'hero', label: '勇者', bg: 'from-yellow-500/25 to-amber-500/25 border-yellow-500/40 text-yellow-300', icon: LuSword },
  { id: 'knight', label: '骑士', bg: 'from-slate-500/25 to-zinc-500/25 border-slate-500/40 text-slate-300', icon: LuCrown },
  { id: 'mage', label: '法师', bg: 'from-violet-500/25 to-fuchsia-500/25 border-violet-500/40 text-violet-300', icon: LuWand },
  { id: 'rogue', label: '游侠', bg: 'from-teal-500/25 to-emerald-500/25 border-teal-500/40 text-teal-300', icon: LuCompass },
]

export function genderSymbol(gender?: CompanionGender) {
  if (gender === 'male') return { symbol: '♂', color: 'text-sky-400', label: '男' }
  if (gender === 'other') return { symbol: '✦', color: 'text-amber-400', label: '中性 / 其他' }
  return { symbol: '♀', color: 'text-rose-400', label: '女' }
}

export function AvatarDisplay({ avatar, name, gender: _gender, size = 'md' }: { avatar?: string; name: string; gender?: CompanionGender; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const isCustom = Boolean(avatar && (avatar.startsWith('data:') || avatar.startsWith('http://') || avatar.startsWith('https://') || avatar.startsWith('/')))
  const preset = AVATAR_PRESETS.find((p) => p.id === avatar) || AVATAR_PRESETS[0]
  const Icon = preset.icon
  const sizeClass = size === 'xl' ? 'size-14' : size === 'lg' ? 'size-12' : size === 'sm' ? 'size-7' : 'size-9'
  const iconSize = size === 'xl' ? 26 : size === 'lg' ? 22 : size === 'sm' ? 14 : 17

  return (
    <div className={cn('relative grid place-items-center shrink-0 rounded-[0.45rem] border bg-gradient-to-br overflow-hidden', preset.bg, sizeClass)}>
      {isCustom ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt={name} className="size-full object-cover" />
      ) : (
        <Icon size={iconSize} />
      )}
    </div>
  )
}

export type CompanionAvatarPickerProps = {
  value: string
  name: string
  gender?: CompanionGender
  onChange: (value: string) => void
  disabled?: boolean
  size?: 'md' | 'lg' | 'xl'
}

export function CompanionAvatarPicker({ value, name, gender, onChange, disabled, size = 'xl' }: CompanionAvatarPickerProps) {
  const locale = useLocaleCode()
  const isZh = locale.startsWith('zh')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<ShadowRoot>()

  useEffect(() => {
    const root = anchorRef.current?.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
  }, [])

  const isCustom = Boolean(value && (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')))

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange(reader.result)
        setOpen(false)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-3">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          ref={anchorRef}
          type="button"
          disabled={disabled}
          aria-label={isZh ? '更改旅伴头像' : 'Change companion avatar'}
          className={cn(
            'group relative grid place-items-center cursor-pointer rounded-[0.45rem] border border-line bg-panel p-0.5 outline-none transition-all hover:border-accent hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45',
            open && 'border-accent ring-2 ring-accent/30'
          )}
        >
          <AvatarDisplay avatar={value} name={name} gender={gender} size={size} />
          <span className="absolute inset-0 flex items-center justify-center rounded-[0.45rem] bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            <LuCamera size={18} className="text-white drop-shadow" />
          </span>
        </Popover.Trigger>

        <Popover.Portal container={container}>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
            <Popover.Popup
              className="flex w-72 flex-col overflow-hidden rounded-md border border-line bg-panel shadow-[0_12px_32px_rgb(0_0_0/0.45)] outline-none"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs font-semibold text-ink">
                <span>{isZh ? '选择预设角色头像' : 'Choose Character Avatar'}</span>
                <span className="text-[11px] font-normal text-ink-soft">{isZh ? '或点击底部上传' : 'or upload below'}</span>
              </div>

              {/* 预设头像网格 */}
              <div className="grid grid-cols-5 gap-2 p-3">
                {AVATAR_PRESETS.map((p) => {
                  const active = !isCustom && value === p.id
                  const Icon = p.icon
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onChange(p.id)
                        setOpen(false)
                      }}
                      title={p.label}
                      className={cn(
                        'relative flex flex-col items-center gap-1 rounded-[0.35rem] border p-1.5 transition-all cursor-pointer',
                        p.bg,
                        active ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel scale-105 shadow-sm' : 'opacity-75 hover:opacity-100 hover:scale-105'
                      )}
                    >
                      <Icon size={18} />
                      <span className="text-[10px] font-medium leading-none truncate max-w-full text-ink">{p.label.split('（')[0]}</span>
                      {active ? (
                        <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-accent text-white">
                          <LuCheck size={10} strokeWidth={3} />
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>

              {/* 底部上传按钮 */}
              <div className="border-t border-line bg-paper p-2.5">
                <Button variant="default" size="md" className="w-full justify-center" onClick={() => fileInputRef.current?.click()}>
                  <LuUpload size={14} className="mr-1.5 text-accent" />
                  {isCustom ? (isZh ? '重新上传本地图片' : 'Upload Another Image') : isZh ? '上传本地图片' : 'Upload Custom Image'}
                </Button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  )
}

export const AvatarPicker = CompanionAvatarPicker
