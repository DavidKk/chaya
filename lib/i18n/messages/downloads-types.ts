/** `downloads.*` messages（右上角下载中心） */
export type DownloadsMessages = {
  title: string
  triggerAria: string
  running: string
  channelServer: string
  channelBrowser: string
  nwShell: string
  nwShellUnknown: string
  phase: {
    resolve: string
    download: string
    extract: string
    install: string
    prepare: string
    awaitFile: string
    queued: string
    read: string
    write: string
  }
  size: string
  speed: string
  eta: string
  resumedFrom: string
  files: string
  awaitFileHint: string
  /** 游戏卡片上等待选压缩包的提示 */
  awaitFileCard: string
  action: { openDownload: string; pickFile: string; abandon: string }
  toast: { shellDone: string; shellFailed: string; retryHint: string; smartScreen: string }
  error: { interrupted: string; requestFailed: string }
}
