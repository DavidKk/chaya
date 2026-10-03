import { installShell, saveConfig } from '@/services/disk-ops'
import { startDownloadJob } from '@/services/downloads/jobs'
import { ensureLatestNwShellSource, pruneShellCacheParts } from '@/services/game/nw-download'

/** 后台下载最新 NW.js 并装入工具 data/shell；进度见 `/api/downloads/stream` */
export function startLatestShellJob(contentRoot: string) {
  return startDownloadJob('nw-shell', async ({ signal, update }) => {
    const dl = await ensureLatestNwShellSource({
      signal,
      onProgress: (p) => {
        if (p.phase === 'resolve') update({ phase: 'resolve' })
        else if (p.phase === 'download') {
          update({ phase: 'download', version: p.version, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes, resumedFrom: p.resumedFrom })
        } else update({ phase: 'extract', version: p.version })
      },
    })
    signal.throwIfAborted()
    update({ phase: 'install', version: dl.version })
    const result = await installShell({ shellSource: dl.shellSource, contentRoot, force: true })
    saveConfig({ shellSource: dl.shellSource })
    pruneShellCacheParts(dl.packDir)
    return {
      ...result,
      nw: { version: dl.version, fileKey: dl.fileKey, chromium: dl.chromium, downloaded: dl.downloaded, shellSource: dl.shellSource },
    }
  })
}
