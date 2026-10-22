/** Shared, serializable contracts; no filesystem or network access. */
export type BergamotFile = {
  name: string
  url: string
  bytes: number
  sha256: string
  unpackedBytes: number
  unpackedSha256: string
}
export type BergamotPack = {
  id: string
  version: string
  source: string
  target: string
  platforms: string[]
  files: BergamotFile[]
  config: string
  licenseUrl?: string
  license: string
  attribution: string
  sample: { text: string; expected: string }
}
export type PackReference = { packId: string; version: string; installId: string }
export type PackJob = {
  id: string
  planId: string
  source: string
  target: string
  packIds: string[]
  state: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  phase: 'downloading' | 'verifying' | 'installing' | 'validating' | 'publishing' | null
  downloadedBytes: number
  totalDownloadBytes: number
  currentFile?: string
  revision: number
  error?: string
  startedAt?: number
  updatedAt: number
}
export type PackPlan = {
  id: string
  source: string
  target: string
  status: string
  installed: boolean
  canInstall: boolean
  downloadBytes: number
  requiredFreeBytes: number
  packs: Array<{ id: string; source: string; target: string; installed: boolean; bytes: number; licenseUrl?: string; license: string; attribution: string }>
  job?: PackJob
}
export const isActivePackJob = (job: PackJob) => ['queued', 'running', 'cancelling'].includes(job.state)
export function bergamotLanguage(input: string): string {
  const value = input.trim().toLowerCase()
  if (['ch', 'zh-cn', 'zh-hans'].includes(value)) return 'zh'
  if (['cht', 'zh-tw', 'zh-hant'].includes(value)) return 'cht'
  if (value === 'pt-br') return 'pt'
  return value
}
