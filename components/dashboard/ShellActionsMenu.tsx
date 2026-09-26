'use client'

import { Menu } from '@base-ui/react/menu'
import { useEffect, useState } from 'react'
import { IoEllipsisHorizontal } from 'react-icons/io5'
import { RiDownloadCloud2Line, RiInstallLine, RiUninstallLine } from 'react-icons/ri'

import { useT } from '@/components/i18n/LocaleProvider'
import { Button } from '@/components/sk'

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
  buttonClassName: string
  onInstall: () => Promise<void>
  onFetchLatest: () => Promise<void>
  onUninstall: () => Promise<void>
}

export function ShellActionsMenu(props: Props) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [upgradeAvailable, setUpgradeAvailable] = useState(false)
  useEffect(() => {
    if (!open || !props.hasShell || !props.canFetch || props.busy) return
    const abort = new AbortController()
    setUpgradeAvailable(false)
    void fetch('/api/shell', { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!abort.signal.aborted) setUpgradeAvailable(response.ok && data.available === true)
      })
      .catch(() => {})
    return () => abort.abort()
  }, [open, props.hasShell, props.canFetch, props.busy])

  if (!props.canInstall && !props.canUninstall && !props.canFetch) return null
  const showDownload = props.canFetch && (!props.hasShell || upgradeAvailable)
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
              <>
                <Menu.Item className={`${itemClass} text-ink`} disabled={props.busy || props.gameOnline || !props.hasSource} onClick={() => void props.onInstall()}>
                  <RiInstallLine size={16} aria-hidden />
                  {t('shellMenu.install')}
                </Menu.Item>
                {!props.hasSource ? <p className="m-0 max-w-56 px-3 py-2 text-xs text-ink-soft">{t('shellMenu.needSource')}</p> : null}
              </>
            ) : null}
            {showDownload ? (
              <Menu.Item className={`${itemClass} text-ink`} disabled={props.busy || props.gameOnline} onClick={() => void props.onFetchLatest()}>
                <RiDownloadCloud2Line size={16} aria-hidden />
                {props.hasShell ? t('shellMenu.upgrade') : t('shellMenu.downloadLatest')}
              </Menu.Item>
            ) : null}
            {props.canUninstall ? (
              <>
                {props.canInstall || showDownload ? <Menu.Separator className="my-1 h-px bg-line" /> : null}
                <Menu.Item className={`${itemClass} text-fail`} disabled={props.busy || props.gameOnline} onClick={() => void props.onUninstall()}>
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
