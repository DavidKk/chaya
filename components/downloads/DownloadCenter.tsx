'use client'

import { Popover } from '@base-ui/react/popover'
import { useEffect, useRef, useState } from 'react'
import { LuDownload } from 'react-icons/lu'

import { DownloadItemRow } from '@/components/downloads/DownloadItemRow'
import { useLocale } from '@/components/i18n/LocaleProvider'
import { dropdownPopupClass, dropdownTriggerClass } from '@/components/sk/dropdownMenu'
import { onDownloadCenterOpenRequest, useDownloads } from '@/lib/downloads/store'
import { cn } from '@/lib/utils'

/**
 * 顶栏右上角下载中心：只展示进行中的托管任务（服务端任务 + 浏览器任务），不提供操作。
 * 没有进行中的任务时整块隐藏；结束结果由 DownloadsRuntime 用通知提示。
 */
export function DownloadCenter() {
  const { t } = useLocale()
  const running = useDownloads().filter((i) => i.status === 'running')
  const visible = running.length > 0
  const [open, setOpen] = useState(false)
  const programmatic = useRef(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [container, setContainer] = useState<ShadowRoot>()

  useEffect(() => {
    const root = anchorRef.current?.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) setContainer(root)
  }, [visible])

  useEffect(
    () =>
      onDownloadCenterOpenRequest(() => {
        programmatic.current = true
        setOpen(true)
      }),
    []
  )

  useEffect(() => {
    if (!visible) setOpen(false)
  }, [visible])

  if (!visible) return null
  const count = running.length > 99 ? '99+' : String(running.length)

  return (
    <span ref={anchorRef} className="inline-flex">
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          programmatic.current = false
          setOpen(next)
        }}
      >
        <Popover.Trigger aria-label={`${t('downloads.triggerAria')}（${t('downloads.running', { count: running.length })}）`} className={cn(dropdownTriggerClass, 'relative')}>
          <LuDownload size={15} aria-hidden className="shrink-0" />
          <span
            aria-hidden
            className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] leading-none font-semibold tabular-nums text-accent-ink"
          >
            {count}
          </span>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
            <Popover.Popup
              aria-label={t('downloads.title')}
              initialFocus={() => !programmatic.current}
              finalFocus={() => !programmatic.current}
              className={cn(dropdownPopupClass, 'flex w-[22rem] max-w-[calc(100vw-1rem)] flex-col p-0')}
            >
              <div className="flex items-center justify-between gap-3 border-b border-[rgb(230_238_248/0.08)] px-3 py-2">
                <Popover.Title className="m-0 text-[0.8125rem] font-semibold text-ink">{t('downloads.title')}</Popover.Title>
                <span className="text-[0.75rem] text-ink-soft">{t('downloads.running', { count: running.length })}</span>
              </div>
              <ul className="m-0 max-h-[60vh] list-none divide-y divide-[rgb(230_238_248/0.06)] overflow-y-auto p-0">
                {running.map((item) => (
                  <DownloadItemRow key={item.id} item={item} />
                ))}
              </ul>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </span>
  )
}
