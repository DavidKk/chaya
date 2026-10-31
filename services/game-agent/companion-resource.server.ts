/**
 * Shared per-resourceKey bounded fair queue for companion route/chat/prepare and control model calls.
 * Slot is released only after the upstream runner settles (cancel confirmation).
 */

import { isCliProvider, isOpenApiProvider } from '@/lib/game-agent/providers'

import { readCompanionResourcePolicy } from './companion-resource-settings.server'
import { COMPANION_RESOURCE_LIMITS, CompanionModelFailure, type CompanionModelPriority } from './companion-types.server'
import type { GameAgentProfile } from './settings'

export type CompanionResourceScheduleInput<T> = {
  resourceKey: string
  requestId: string
  priority: CompanionModelPriority
  signal?: AbortSignal
  /** Includes queue wait. Queued requests fail with MODEL_TIMEOUT when exceeded. */
  totalTimeoutMs?: number
  /** Optional shorter admission deadline when startup has a separate allowance. */
  queueTimeoutMs?: number
  instanceId?: string
  onQueued?: (position: number) => void
  run: (slotSignal: AbortSignal) => Promise<T>
}

type QueueEntry = {
  requestId: string
  instanceId: string
  priority: CompanionModelPriority
  enqueuedAt: number
  signal?: AbortSignal
  detachQueuedAbort?: () => void
  clearQueueTimeout?: () => void
  begin: () => void
  fail: (error: unknown) => void
}

type ResourceLane = {
  key: string
  capacity: number
  running: number
  runningByInstance: Map<string, number>
  lastInstance?: string
  queue: QueueEntry[]
  prefer: 'foreground' | 'control'
  lastUsedAt: number
}

const lanes = new Map<string, ResourceLane>()
const MAX_LANES = 64
const IDLE_LANE_MS = 10 * 60_000

function hostKey(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    return `${url.protocol}//${url.host}`
  } catch {
    return endpoint.trim().replace(/\/+$/, '') || 'invalid-endpoint'
  }
}

function isLocalHost(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0'
  } catch {
    return false
  }
}

/**
 * Collapse profiles that share one inference resource.
 * Local CLI + local Ollama share one conservative `local-inference` lane.
 * OpenAPI profiles on the same host share one lane (not split by model/profile).
 */
export function companionResourceKey(profile: GameAgentProfile, _model?: string): string {
  void _model
  if (isCliProvider(profile.provider)) return 'local-inference'
  if (profile.provider === 'ollama') return isLocalHost(profile.endpoint) ? 'local-inference' : `ollama:${hostKey(profile.endpoint)}`
  if (isOpenApiProvider(profile.provider)) return `openapi:${hostKey(profile.endpoint)}`
  return `provider:${profile.provider}:${hostKey(profile.endpoint || profile.id)}`
}

function touch(lane: ResourceLane) {
  lane.lastUsedAt = Date.now()
}

function reapIdleLanes(now = Date.now()) {
  for (const [key, lane] of lanes) {
    if (lane.running === 0 && lane.queue.length === 0 && now - lane.lastUsedAt >= IDLE_LANE_MS) lanes.delete(key)
  }
  if (lanes.size <= MAX_LANES) return
  const idle = [...lanes.entries()].filter(([, lane]) => lane.running === 0 && lane.queue.length === 0).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
  for (const [key] of idle) {
    if (lanes.size <= MAX_LANES) break
    lanes.delete(key)
  }
}

function laneFor(resourceKey: string): ResourceLane {
  reapIdleLanes()
  const policy = readCompanionResourcePolicy(resourceKey)
  let lane = lanes.get(resourceKey)
  if (!lane) {
    if (lanes.size >= MAX_LANES) {
      const idle = [...lanes.values()].filter((candidate) => candidate.running === 0 && candidate.queue.length === 0).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0]
      if (idle) lanes.delete(idle.key)
      else throw new CompanionModelFailure({ code: 'MODEL_BUSY', message: 'Model resource limit reached', retryable: true, resourceKey })
    }
    lane = { key: resourceKey, capacity: policy.capacity, running: 0, runningByInstance: new Map(), queue: [], prefer: 'foreground', lastUsedAt: Date.now() }
    lanes.set(resourceKey, lane)
  } else lane.capacity = policy.capacity
  touch(lane)
  return lane
}

function backgroundQueuedCount(lane: ResourceLane) {
  return lane.queue.reduce((count, item) => count + (item.priority === 'background' ? 1 : 0), 0)
}

function queuePosition(lane: ResourceLane, entry: QueueEntry) {
  const index = lane.queue.indexOf(entry)
  return index >= 0 ? index + 1 : lane.queue.length + 1
}

function takeNext(lane: ResourceLane): QueueEntry | undefined {
  if (!lane.queue.length) return undefined
  const policy = readCompanionResourcePolicy(lane.key)
  const eligible = lane.queue.filter((item) => (lane.runningByInstance.get(item.instanceId) ?? 0) < policy.maxRunningPerInstance)
  const interactive = eligible.filter((item) => item.priority !== 'background')
  const group = interactive.length ? interactive : eligible
  const other = group.find((item) => item.instanceId !== lane.lastInstance)
  const candidates = group.filter((item) => item.instanceId === (other?.instanceId ?? group[0]?.instanceId))
  const foreground = candidates.find((item) => item.priority === 'foreground')
  const control = candidates.find((item) => item.priority === 'control')
  let chosen: QueueEntry | undefined
  if (foreground && control) {
    chosen = lane.prefer === 'control' ? control : foreground
  } else {
    chosen = foreground || control || candidates.find((item) => item.priority === 'background')
  }
  if (!chosen) return undefined
  if (chosen.priority !== 'background') lane.prefer = chosen.priority === 'foreground' ? 'control' : 'foreground'
  lane.lastInstance = chosen.instanceId
  lane.queue = lane.queue.filter((item) => item !== chosen)
  chosen.detachQueuedAbort?.()
  chosen.detachQueuedAbort = undefined
  chosen.clearQueueTimeout?.()
  chosen.clearQueueTimeout = undefined
  return chosen
}

function rejectBusy(requestId: string, resourceKey: string, message: string): never {
  throw new CompanionModelFailure({
    code: 'MODEL_BUSY',
    message,
    retryable: true,
    requestId,
    resourceKey,
  })
}

function attachParentAbort(parent: AbortSignal | undefined, slot: AbortController): () => void {
  if (!parent) return () => undefined
  const onParentAbort = () => slot.abort(parent.reason ?? new DOMException('Aborted', 'AbortError'))
  if (parent.aborted) {
    onParentAbort()
    return () => undefined
  }
  parent.addEventListener('abort', onParentAbort)
  return () => parent.removeEventListener('abort', onParentAbort)
}

function pump(lane: ResourceLane) {
  touch(lane)
  lane.capacity = readCompanionResourcePolicy(lane.key).capacity
  while (lane.running < lane.capacity) {
    const next = takeNext(lane)
    if (!next) {
      if (lane.running === 0 && lane.queue.length === 0) reapIdleLanes()
      return
    }
    if (next.signal?.aborted) {
      next.fail(
        new CompanionModelFailure({
          code: 'CANCELLED',
          message: 'Request cancelled while queued',
          retryable: false,
          requestId: next.requestId,
          resourceKey: lane.key,
        })
      )
      continue
    }
    lane.running += 1
    lane.runningByInstance.set(next.instanceId, (lane.runningByInstance.get(next.instanceId) ?? 0) + 1)
    next.begin()
  }
}

/**
 * Acquire one upstream slot for `resourceKey`, run `input.run`, and release only after settlement.
 * Cancel aborts the slot signal but keeps the occupancy until `run` finishes.
 */
export function scheduleCompanionResource<T>(input: CompanionResourceScheduleInput<T>): Promise<T> {
  const lane = laneFor(input.resourceKey)
  const instanceId = input.instanceId || 'unscoped'
  const policy = readCompanionResourcePolicy(input.resourceKey)
  const waitedFrom = Date.now()
  const totalTimeoutMs = input.totalTimeoutMs && input.totalTimeoutMs > 0 ? input.totalTimeoutMs : undefined
  const queueTimeoutMs = input.queueTimeoutMs ?? totalTimeoutMs

  if (input.signal?.aborted) {
    return Promise.reject(
      new CompanionModelFailure({
        code: 'CANCELLED',
        message: 'Request cancelled before scheduling',
        retryable: false,
        requestId: input.requestId,
        resourceKey: input.resourceKey,
      })
    )
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let detachSlotAbort: (() => void) | undefined

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      detachSlotAbort?.()
      detachSlotAbort = undefined
      fn()
    }

    const begin = () => {
      const slot = new AbortController()
      detachSlotAbort = attachParentAbort(input.signal, slot)
      const timeout =
        totalTimeoutMs === undefined
          ? undefined
          : setTimeout(() => slot.abort(new DOMException('Model request timed out', 'TimeoutError')), Math.max(1, totalTimeoutMs - (Date.now() - waitedFrom)))
      void (async () => {
        try {
          if (queueTimeoutMs !== undefined && Date.now() - waitedFrom >= queueTimeoutMs) {
            throw new CompanionModelFailure({
              code: 'MODEL_TIMEOUT',
              message: 'Model request timed out while queued',
              retryable: true,
              requestId: input.requestId,
              resourceKey: input.resourceKey,
            })
          }
          const value = await input.run(slot.signal)
          slot.signal.throwIfAborted()
          finish(() => resolve(value))
        } catch (error) {
          finish(() => reject(error))
        } finally {
          if (timeout) clearTimeout(timeout)
          lane.running = Math.max(0, lane.running - 1)
          const running = (lane.runningByInstance.get(instanceId) ?? 1) - 1
          if (running) lane.runningByInstance.set(instanceId, running)
          else lane.runningByInstance.delete(instanceId)
          touch(lane)
          pump(lane)
        }
      })()
    }

    if (lane.running < lane.capacity && lane.queue.length === 0 && (lane.runningByInstance.get(instanceId) ?? 0) < policy.maxRunningPerInstance) {
      lane.running += 1
      lane.lastInstance = instanceId
      if (input.priority !== 'background') lane.prefer = input.priority === 'foreground' ? 'control' : 'foreground'
      lane.runningByInstance.set(instanceId, (lane.runningByInstance.get(instanceId) ?? 0) + 1)
      begin()
      return
    }

    if (input.priority === 'background' && backgroundQueuedCount(lane) >= COMPANION_RESOURCE_LIMITS.maxBackgroundQueued) {
      rejectBusy(input.requestId, input.resourceKey, 'Background model queue is full for this resource')
    }
    if (lane.queue.length >= COMPANION_RESOURCE_LIMITS.maxQueued) {
      rejectBusy(input.requestId, input.resourceKey, 'Model resource queue is full')
    }
    if (lane.queue.filter((entry) => entry.instanceId === instanceId).length >= policy.maxQueuedPerInstance) {
      rejectBusy(input.requestId, input.resourceKey, 'Model queue is full for this game instance')
    }

    const entry: QueueEntry = {
      requestId: input.requestId,
      instanceId,
      priority: input.priority,
      enqueuedAt: Date.now(),
      signal: input.signal,
      begin,
      fail: (error) => finish(() => reject(error)),
    }

    const onQueuedAbort = () => {
      const index = lane.queue.indexOf(entry)
      if (index < 0) return
      lane.queue.splice(index, 1)
      entry.detachQueuedAbort?.()
      entry.detachQueuedAbort = undefined
      entry.clearQueueTimeout?.()
      entry.clearQueueTimeout = undefined
      entry.fail(
        new CompanionModelFailure({
          code: 'CANCELLED',
          message: 'Request cancelled while queued',
          retryable: false,
          requestId: input.requestId,
          resourceKey: input.resourceKey,
        })
      )
    }
    if (input.signal) {
      input.signal.addEventListener('abort', onQueuedAbort)
      entry.detachQueuedAbort = () => input.signal?.removeEventListener('abort', onQueuedAbort)
    }

    if (queueTimeoutMs !== undefined) {
      const remaining = Math.max(1, queueTimeoutMs - (Date.now() - waitedFrom))
      const timer = setTimeout(() => {
        const index = lane.queue.indexOf(entry)
        if (index < 0) return
        lane.queue.splice(index, 1)
        entry.detachQueuedAbort?.()
        entry.detachQueuedAbort = undefined
        entry.clearQueueTimeout = undefined
        entry.fail(
          new CompanionModelFailure({
            code: 'MODEL_TIMEOUT',
            message: 'Model request timed out while queued',
            retryable: true,
            requestId: input.requestId,
            resourceKey: input.resourceKey,
          })
        )
      }, remaining)
      entry.clearQueueTimeout = () => clearTimeout(timer)
    }

    lane.queue.push(entry)
    input.onQueued?.(queuePosition(lane, entry))
    pump(lane)
  })
}

/** Test/helper: inspect one lane without mutating it. */
export function peekCompanionResource(resourceKey: string) {
  const lane = lanes.get(resourceKey)
  if (!lane) return { resourceKey, running: 0, queued: 0, backgroundQueued: 0, capacity: COMPANION_RESOURCE_LIMITS.defaultCapacity }
  return {
    resourceKey,
    running: lane.running,
    queued: lane.queue.length,
    backgroundQueued: backgroundQueuedCount(lane),
    capacity: lane.capacity,
    prefer: lane.prefer,
  }
}

/** Test helper only: drop empty in-memory lanes. */
export function resetCompanionResourcesForTests() {
  lanes.clear()
}
