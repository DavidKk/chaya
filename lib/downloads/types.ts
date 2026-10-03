/** 下载中心：服务端后台任务与浏览器内任务共用的数据形状 */

export type DownloadStatus = 'running' | 'done' | 'error' | 'canceled'

/** 服务端后台下载的种类；前端按种类组装本地化标题 */
export type ServerDownloadKind = 'nw-shell'

/** 服务端阶段：resolve 查版本 → download 下载 → extract 解压 → install 安装 */
export type ServerDownloadPhase = 'resolve' | 'download' | 'extract' | 'install'

export type ServerDownloadJob = {
  id: string
  kind: ServerDownloadKind
  status: DownloadStatus
  phase: ServerDownloadPhase
  /** 例如 NW.js 版本号 */
  version?: string
  receivedBytes?: number
  totalBytes?: number
  /** 本次从多少字节续传（0 / 缺省表示从头） */
  resumedFrom?: number
  error?: string
  startedAt: number
  finishedAt?: number
  result?: Record<string, unknown>
}

/** 浏览器任务阶段：prepare 拉版本 / 查缓存 → awaitFile 等用户下载并选文件 → queued 等待页面内读写队列 → read 读取并写缓存 → write 写入游戏目录 */
export type BrowserDownloadPhase = 'prepare' | 'awaitFile' | 'queued' | 'read' | 'write'

export function downloadPercent(received?: number, total?: number): number | undefined {
  if (!total || total <= 0 || received == null) return undefined
  return Math.max(0, Math.min(100, Math.round((received / total) * 100)))
}
