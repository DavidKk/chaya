import { listPackDownloadJobs } from '@/services/translate/bergamot/download-jobs'

import { listDownloadJobs } from './jobs'

export function downloadSnapshot() {
  return [...listDownloadJobs(), ...listPackDownloadJobs()].sort((a, b) => b.startedAt - a.startedAt)
}
