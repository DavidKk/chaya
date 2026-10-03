import { defineApiRoute } from '@/initializer/controller'
import { apiOk } from '@/initializer/response'
import { requireDisk } from '@/services/disk-ops'
import { listDownloadJobs } from '@/services/downloads/jobs'

export const runtime = 'nodejs'

/** 服务端后台下载列表（实时进度走 `/api/downloads/stream`） */
export const GET = defineApiRoute('get:/api/downloads', async () => {
  const denied = requireDisk()
  if (denied) return denied
  return apiOk({ jobs: listDownloadJobs() })
})
