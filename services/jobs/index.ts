/**
 * Thin local job/offload primitives for the Chaya console.
 * Not a distributed queue — singleFlight + one-shot workers + orphan demote.
 *
 * On this layer today:
 * - singleFlight / yieldEventLoop — seed-prepare, list-extract, shared migrate-bg
 * - runWorkerOnce — seed inventory + list extract one-shots
 * - shouldDemoteOrphanRunning — seed-job + sources-job poll/export
 *
 * Keep out (different shape): downloads board (restart → error), bergamot pack jobs,
 * cache-lane (long-lived soft-fail), seed runLoop / engine capacity, storage daemon IPC.
 */
export { type JobLifecycleStatus, shouldDemoteOrphanRunning } from './orphan'
export { runWorkerOnce, type RunWorkerOnceOptions, type WorkerOnceMessage } from './run-worker-once'
export { singleFlight, yieldEventLoop } from './single-flight'
