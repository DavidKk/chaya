'use client'

import { useState } from 'react'
import { LuFolderOpen, LuSquareArrowOutUpRight } from 'react-icons/lu'

import { useLocale } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { Button, TextAction } from '@/components/sk'
import { useBrowserAwaitFile, useDownloadActions } from '@/lib/downloads/store'

/** 浏览器装壳等待用户选压缩包时，在卡片上承接需要用户手势的操作（选文件 / 打开下载 / 放弃）；下载中心只展示 */
export function ShellAwaitFile({ gameId, buttonClassName }: { gameId?: string; buttonClassName: string }) {
  const { t } = useLocale()
  const notify = useNotification()
  const item = useBrowserAwaitFile('nw-shell', gameId)
  const actions = useDownloadActions(item?.id ?? '')
  const [picking, setPicking] = useState(false)
  if (!item || !actions?.pickFile) return null

  const pick = async () => {
    setPicking(true)
    try {
      await actions.pickFile?.()
    } catch (err) {
      notify.error(t('downloads.error.requestFailed', { error: err instanceof Error ? err.message : String(err) }))
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {item.archiveName ? <p className="m-0 text-[0.8125rem] text-ink-soft">{t('downloads.awaitFileCard', { name: item.archiveName })}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button className={buttonClassName} variant="accent" loading={picking} onClick={() => void pick()}>
          <LuFolderOpen size={17} aria-hidden />
          {t('downloads.action.pickFile')}
        </Button>
        {actions.openDownload ? (
          <Button className={buttonClassName} variant="ghost" disabled={picking} onClick={() => void actions.openDownload?.()}>
            <LuSquareArrowOutUpRight size={16} aria-hidden />
            {t('downloads.action.openDownload')}
          </Button>
        ) : null}
        {actions.abandon ? (
          <TextAction disabled={picking} onClick={() => void actions.abandon?.()}>
            {t('downloads.action.abandon')}
          </TextAction>
        ) : null}
      </div>
    </div>
  )
}
