import type { InteractEvidence, Job, JobResult } from './types'

type Loose = Record<string, unknown>

function isObject(value: unknown): value is Loose {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function evidenceFrom(result: Loose): InteractEvidence {
  const history = isObject(result.historyRange) ? result.historyRange : null
  const fromSeq = history && typeof history.fromSeq === 'number' ? history.fromSeq : null
  const toSeq = history && typeof history.toSeq === 'number' ? history.toSeq : 0
  return {
    messages: Array.isArray(result.messages) ? result.messages.map(String) : [],
    goldChange: typeof result.goldChange === 'number' ? result.goldChange : 0,
    inventoryChanges: Array.isArray(result.inventoryChanges) ? result.inventoryChanges : [],
    historyRange: { fromSeq, toSeq },
    completeness: {
      messagesTruncated: result.messagesTruncated === true,
      historyGap: result.historyGap === true,
    },
  }
}

/**
 * Map `player.interact` / `chaya_live_interact` results for the batch path.
 * `openDoors` must already be false at the call site; this only interprets outcomes.
 */
export function mapInteractOutcome(job: Job, result: unknown, opts: { leftStartBounds?: boolean; inBattle?: boolean; busyEventId?: number | null } = {}): JobResult {
  if (opts.inBattle) return { status: 'world_changed', reason: 'battle' }
  if (opts.leftStartBounds) return { status: 'world_changed', reason: 'left_start_bounds' }
  if (!isObject(result)) return { status: 'stopped', reason: 'effect_unknown', detail: result }

  const outcome = typeof result.outcome === 'string' ? result.outcome : ''
  const eventId = Number(result.eventId)
  const busyOther = opts.busyEventId != null && Number.isFinite(opts.busyEventId) && opts.busyEventId !== job.eventId

  if (outcome === 'input_required' || outcome === 'choice') {
    if (busyOther || (Number.isFinite(eventId) && eventId > 0 && eventId !== job.eventId)) {
      return { status: 'busy_other', reason: 'other_event_busy', busyEventId: Number.isFinite(eventId) ? eventId : opts.busyEventId || undefined, detail: result }
    }
    // Pre-start busy with no event id on the target → treat as other busy (interact returns this before trigger).
    if (outcome === 'input_required' && result.hint && String(result.hint).includes('before interacting') && eventId === job.eventId) {
      return { status: 'busy_other', reason: 'other_event_busy', detail: result }
    }
    return { status: 'needs_decision', reason: outcome === 'choice' ? 'choice' : 'input_required', state: result }
  }

  if (outcome === 'done') return { status: 'done', evidence: evidenceFrom(result) }
  if (outcome === 'gone' || outcome === 'nothing_to_run' || outcome === 'runs_by_itself') return { status: 'skipped', reason: outcome }
  if (outcome === 'no_path' || outcome === 'no_reaction') {
    const blockedBy = Array.isArray(result.blockedBy)
      ? result.blockedBy.map((item) => (isObject(item) ? Number(item.eventId) : Number(item))).filter((id) => Number.isInteger(id) && id > 0)
      : undefined
    return { status: 'blocked', reason: outcome, ...(blockedBy?.length ? { blockedBy } : {}), detail: result }
  }
  if (outcome === 'timeout') return { status: 'stopped', reason: 'effect_unknown', detail: result }
  if (outcome === 'transferred' || outcome === 'transferred_on_the_way' || outcome === 'scene_changed') {
    return { status: 'world_changed', reason: outcome }
  }
  if (outcome === 'interrupted') return { status: 'stopped', reason: 'interrupted', detail: result }
  if (result.transferred === true) return { status: 'world_changed', reason: 'transferred' }
  return { status: 'stopped', reason: 'effect_unknown', detail: result }
}

export function summarizeResult(job: Job, result: JobResult): string {
  if (result.status === 'done') return `交互 ${job.eventId} 完成`
  if (result.status === 'skipped') return `跳过 ${job.eventId}（${result.reason}）`
  if (result.status === 'blocked') return `受阻 ${job.eventId}（${result.reason}）`
  if (result.status === 'needs_decision') return `等待决策 ${job.eventId}（${result.reason}）`
  if (result.status === 'busy_other') return `其它事件占用输入`
  if (result.status === 'world_changed') return `世界变化（${result.reason}）`
  return `停止（${result.reason}）`
}

export function formatJobReply(run: { ledger: Map<string, { status: string; note: string }>; spec: { summary: string } }): string {
  let done = 0
  let skipped = 0
  let failed = 0
  for (const entry of run.ledger.values()) {
    if (entry.status === 'done') done += 1
    else if (entry.status === 'skipped') skipped += 1
    else failed += 1
  }
  const parts = [`${run.spec.summary}`, `完成 ${done}`, skipped ? `跳过 ${skipped}` : '', failed ? `失败 ${failed}` : ''].filter(Boolean)
  return parts.join(' · ')
}
