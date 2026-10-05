'use client'

import { Menu } from '@base-ui/react/menu'
import { useEffect, useRef, useState } from 'react'
import { IoEllipsisHorizontal } from 'react-icons/io5'
import { RiDownloadCloud2Line, RiInstallLine, RiUninstallLine } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button, Spinner, Tooltip } from '@/components/sk'

const itemClass =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-panel-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45'

type Props = {
  busy: boolean
  gameOnline: boolean
  canInstall: boolean
  canUninstall: boolean
  canFetch: boolean
  hasShell: boolean
  hasSource: boolean
  /** 下载 / 安装任务进行中：禁用安装、下载、升级、卸载 */
  jobRunning?: boolean
  buttonClassName: string
  onInstall: () => Promise<void>
  onFetchLatest: () => Promise<void>
  onUninstall: () => Promise<void>
  /** Re-read the game / shell status while the menu is open */
  onRefresh?: () => Promise<unknown>
}

const OPEN_REFRESH_MS = 3_000

export function ShellActionsMenu(props: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  /** `latest`: versions were compared and nothing newer exists; `unknown` covers no shell / failed check; `checking` only until the first result */
  const [shellVersion, setShellVersion] = useState<'unknown' | 'checking' | 'latest' | 'outdated'>('unknown')
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    let settled = false
    setShellVersion('unknown')
    const settle = (next: 'unknown' | 'latest' | 'outdated') => {
      settled = true
      setShellVersion(next)
    }
    const check = () => {
      const { hasShell, canFetch, busy, onRefresh } = latest.current
      void onRefresh?.()
      if (!hasShell) settle('unknown')
      if (!hasShell || !canFetch || busy) return
      if (!settled) setShellVersion('checking')
      void fetch('/api/shell', { signal: abort.signal })
        .then(async (response) => {
          const data = (await response.json()) as { available?: boolean; currentChromium?: string; latestChromium?: string }
          if (abort.signal.aborted) return
          if (!response.ok) settle('unknown')
          else if (data.available === true) settle('outdated')
          else settle(data.currentChromium && data.latestChromium ? 'latest' : 'unknown')
        })
        .catch(() => {
          if (!abort.signal.aborted) settle('unknown')
        })
    }
    check()
    const timer = window.setInterval(check, OPEN_REFRESH_MS)
    return () => {
      window.clearInterval(timer)
      abort.abort()
    }
  }, [open])

  if (!props.canInstall && !props.canUninstall && !props.canFetch) return null
  const showDownload = props.canFetch
  const showUninstall = props.canUninstall && !props.canInstall
  const locked = props.busy || props.gameOnline || !!props.jobRunning
  const installItem = (
    <Menu.Item className={`${itemClass} text-ink`} disabled={locked || !props.hasSource} onClick={() => void props.onInstall()}>
      <RiInstallLine size={16} aria-hidden />
      {t('shellMenu.install')}
    </Menu.Item>
  )
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger disabled={props.busy} render={<Button className={props.buttonClassName} variant="ghost" />}>
        <IoEllipsisHorizontal size={18} aria-hidden />
        {t('common.more')}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} positionMethod="fixed" className="z-[70]">
          <Menu.Popup aria-label={t('shellMenu.aria')} className="min-w-44 max-w-[calc(100vw-1rem)] rounded-md border border-line bg-panel p-1 shadow-xl outline-none">
            {props.gameOnline ? <p className="m-0 max-w-56 px-3 py-2 text-xs text-ink-soft">{t('shellMenu.quitFirst')}</p> : null}
            {props.canInstall ? (
              props.hasSource ? (
                installItem
              ) : (
                <Tooltip content={t('shellMenu.needSource')} placement="right">
                  {installItem}
                </Tooltip>
              )
            ) : null}
            {showDownload ? (
              <Menu.Item
                className={`${itemClass} text-ink`}
                disabled={locked || shellVersion === 'latest' || shellVersion === 'checking'}
                onClick={() => void props.onFetchLatest()}
              >
                {shellVersion === 'checking' ? <Spinner size="sm" label={t('shellMenu.checking')} /> : <RiDownloadCloud2Line size={16} aria-hidden />}
                {shellVersion === 'checking'
                  ? t('shellMenu.checking')
                  : shellVersion === 'outdated'
                    ? t('shellMenu.upgrade')
                    : shellVersion === 'latest'
                      ? t('shellMenu.upToDate')
                      : t('shellMenu.downloadLatest')}
              </Menu.Item>
            ) : null}
            {showUninstall ? (
              <>
                {props.canInstall || showDownload ? <Menu.Separator className="my-1 h-px bg-line" /> : null}
                <Menu.Item className={`${itemClass} text-fail`} disabled={locked} onClick={() => void props.onUninstall()}>
                  <RiUninstallLine size={16} aria-hidden />
                  {t('shellMenu.uninstall')}
                </Menu.Item>
              </>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
