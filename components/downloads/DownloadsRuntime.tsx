'use client'

import { useEffect } from 'react'

import { useLocale } from '@/components/i18n/LocaleProvider'
import { useNotification } from '@/components/notification/useNotification'
import { serverDownloadsEnabled, startServerDownloadSync } from '@/lib/downloads/server-sync'
import { onDownloadFinished, useDownloads } from '@/lib/downloads/store'

/** 挂在 AppShell：启停服务端同步、结束提示、浏览器读写阶段的离开确认。不渲染 DOM。 */
export function DownloadsRuntime() {
  const { t } = useLocale()
  const notify = useNotification()
  const items = useDownloads()

  useEffect(() => {
    let stop: (() => void) | undefined
    let disposed = false
    void serverDownloadsEnabled().then((enabled) => {
      if (enabled && !disposed) stop = startServerDownloadSync()
    })
    return () => {
      disposed = true
      stop?.()
    }
  }, [])

  useEffect(
    () =>
      onDownloadFinished((item) => {
        if (item.status === 'done') {
          const done = t('downloads.toast.shellDone', { version: item.version ?? '' })
          notify.success(item.channel === 'browser' ? `${done}。${t('downloads.toast.smartScreen')}` : done)
        } else if (item.status === 'error') {
          const reason = item.interrupted ? t('downloads.error.interrupted') : (item.error ?? '')
          notify.error(`${t('downloads.toast.shellFailed', { error: reason })}${item.interrupted ? '' : `（${t('downloads.toast.retryHint')}）`}`)
        }
      }),
    [notify, t]
  )

  const writing = items.some((i) => i.channel === 'browser' && i.status === 'running' && (i.phase === 'read' || i.phase === 'write'))
  useEffect(() => {
    if (!writing) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [writing])

  return null
}
