import type { SeedJobSnapshot } from './seed-job-state'

export const SEED_JOB_WORKER_VERSION = 1

export type SeedJobWorkerCommand = 'snapshot' | 'refresh' | 'start' | 'pause' | 'drain'

export type SeedJobWorkerRequest = {
  type: 'request'
  id: number
  command: SeedJobWorkerCommand
}

export type SeedJobWorkerMessage =
  | { type: 'ready'; version: number }
  | { type: 'snapshot'; snapshot: SeedJobSnapshot }
  | { type: 'response'; id: number; ok: true; snapshot: SeedJobSnapshot }
  | { type: 'response'; id: number; ok: false; error: string }
