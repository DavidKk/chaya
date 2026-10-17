import { hasDeferred, isBattleOrOffMap, leftStartBounds, mergeCandidates, pickNext, remainingJobs } from './candidates'
import { summarizeResult } from './interact-job'
import { type Job, type JobOutcome, type JobResult, type JobRun, MAX_JOB_FAILURES, MAX_JOB_STEPS, type PendingJob } from './types'

export type JobIo = {
  checkAbortAndBudget(run: JobRun, signal: AbortSignal): void
  observe(signal: AbortSignal): Promise<unknown>
  withinBoundary(state: unknown, run: JobRun): boolean
  interact(job: Job, opts: { version: number; state: unknown; openDoors: false }, signal: AbortSignal): Promise<JobResult>
  continuePending(run: JobRun, state: unknown, signal: AbortSignal): Promise<JobResult | { status: 'waiting_user' }>
  createPending(job: Job, result: Extract<JobResult, { status: 'needs_decision' }>, version: number): PendingJob
  askPlayer(run: JobRun, question: string, signal: AbortSignal): Promise<'continue' | 'stop'>
}

function pushLog(run: JobRun, job: Job, result: JobResult) {
  run.log.push({ key: job.key, status: result.status, note: summarizeResult(job, result) })
  if (run.log.length > 40) run.log.splice(0, run.log.length - 40)
}

function settle(run: JobRun, job: Job, result: Extract<JobResult, { status: 'done' | 'skipped' }>) {
  run.ledger.set(job.key, { status: result.status === 'done' ? 'done' : 'skipped', note: summarizeResult(job, result) })
  run.pending = undefined
}

function fail(run: JobRun, job: Job, result: JobResult) {
  run.ledger.set(job.key, { status: 'failed', note: summarizeResult(job, result) })
  run.pending = undefined
}

function hasFailures(run: JobRun) {
  for (const entry of run.ledger.values()) if (entry.status === 'failed') return true
  return false
}

export async function runJobs(run: JobRun, io: JobIo, signal: AbortSignal): Promise<JobOutcome> {
  for (;;) {
    io.checkAbortAndBudget(run, signal)
    if (run.attempts >= MAX_JOB_STEPS || Date.now() > run.deadline) return { status: 'limit', run }

    const version = run.specVersion
    const state = await io.observe(signal)
    io.checkAbortAndBudget(run, signal)
    if (version !== run.specVersion) continue
    if (!io.withinBoundary(state, run) || isBattleOrOffMap(state) || leftStartBounds(state, run.boundary.startVisibleBounds, run.boundary.startMapId)) {
      return { status: 'out_of_scope', run }
    }
    mergeCandidates(run, state)

    if (run.pending) {
      const result = await io.continuePending(run, state, signal)
      io.checkAbortAndBudget(run, signal)
      if (result.status === 'waiting_user') return { status: 'waiting_user', run, question: '请完成当前对话或选项后继续。' }
      pushLog(run, run.pending.job, result)
      if (result.status === 'stopped') return { status: 'stopped', run }
      if (result.status === 'world_changed') return { status: 'out_of_scope', run }
      if (version !== run.specVersion) continue
      if (result.status === 'done' || result.status === 'skipped') settle(run, run.pending.job, result)
      else if (result.status === 'needs_decision') {
        const decision = await io.askPlayer(run, '当前事件需要你选择。', signal)
        if (decision === 'stop') return { status: 'stopped', run }
        continue
      } else if (result.status === 'busy_other') {
        return { status: 'waiting_user', run, question: '游戏正在处理其它对话或事件，请处理后再继续。' }
      }
      run.pending = undefined
      continue
    }

    const jobs = remainingJobs(run)
    if (!jobs.length) {
      if (hasDeferred(run)) return { status: 'partial', run, reason: 'uncertain_kind' }
      return { status: hasFailures(run) ? 'partial' : 'completed', run }
    }
    const job = pickNext(jobs, run)
    if (!job) return { status: 'unreachable', run, remaining: jobs }

    run.attempts += 1
    const result = await io.interact(job, { version, state, openDoors: false }, signal)
    pushLog(run, job, result)
    io.checkAbortAndBudget(run, signal)

    switch (result.status) {
      case 'done':
      case 'skipped':
        settle(run, job, result)
        break
      case 'blocked': {
        const count = (run.failures.get(job.key) || 0) + 1
        run.failures.set(job.key, count)
        if (count >= MAX_JOB_FAILURES) fail(run, job, result)
        break
      }
      case 'needs_decision': {
        run.pending = io.createPending(job, result, version)
        const decision = await io.askPlayer(run, result.reason === 'choice' ? '请选择对话选项。' : '请完成当前输入。', signal)
        if (decision === 'stop') return { status: 'stopped', run }
        break
      }
      case 'busy_other':
        return { status: 'waiting_user', run, question: '游戏正在处理其它对话或事件，请处理后再继续。' }
      case 'world_changed':
        return { status: 'out_of_scope', run }
      case 'stopped':
        return { status: 'stopped', run }
    }
  }
}
