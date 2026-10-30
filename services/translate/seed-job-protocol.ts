import type { TranslationRuntimeLog } from './runtime-log'
import type { SeedJobSnapshot } from './seed-job-state'

export const SEED_JOB_WORKER_VERSION = 1

export type SeedJobWorkerCommand = 'snapshot' | 'refresh' | 'start' | 'pause' | 'drain'

export type SeedJobWorkerRequest = {
  type: 'request'
  id: number
  command: SeedJobWorkerCommand
  contentRoot?: string
  requestId?: string
  sentAt?: number
}

export type SeedJobWorkerMessage = (
  | { type: 'ready'; version: number }
  | { type: 'translation-log'; entry: TranslationRuntimeLog }
  | { type: 'snapshot'; snapshot: SeedJobSnapshot }
  | { type: 'response'; id: number; ok: true; snapshot: SeedJobSnapshot }
  | { type: 'response'; id: number; ok: false; error: string }
) & { timing?: { executeMs: number; receivedAt: number; respondedAt: number } }
