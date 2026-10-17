import { normalizeEventKind } from './kind'
import { eventPassesSpec, inVisibleBounds } from './spec'
import { type Candidate, type Job, jobKey, type JobRun, MAX_JOB_FAILURES, type VisibleBounds } from './types'

type Loose = Record<string, unknown>

function isObject(value: unknown): value is Loose {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function objects(value: unknown): Loose[] {
  return Array.isArray(value) ? value.filter(isObject) : []
}

export function readVisibleBounds(state: unknown): VisibleBounds | null {
  const map = isObject(state) && isObject(state.map) ? state.map : null
  const bounds = map && isObject(map.visibleBounds) ? map.visibleBounds : null
  if (!bounds) return null
  const minX = Number(bounds.minX)
  const maxX = Number(bounds.maxX)
  const minY = Number(bounds.minY)
  const maxY = Number(bounds.maxY)
  if (![minX, maxX, minY, maxY].every(Number.isFinite)) return null
  return { minX, maxX, minY, maxY }
}

export function readMapId(state: unknown): number | null {
  const map = isObject(state) && isObject(state.map) ? state.map : null
  const id = Number(map?.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function readPlayerPosition(state: unknown): { x: number; y: number } | null {
  const player = isObject(state) && isObject(state.player) ? state.player : null
  const x = Number(player?.x)
  const y = Number(player?.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

export function candidateFromEvent(event: Loose, mapId: number, state: unknown): Candidate | null {
  const eventId = Number(event.id)
  const x = Number(event.x)
  const y = Number(event.y)
  if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null
  return {
    eventId,
    mapId,
    x,
    y,
    normalizedKind: normalizeEventKind(event, state),
    interactive: event.interactive !== false,
    opened: event.opened === true,
    routeStatus: typeof event.routeStatus === 'string' ? event.routeStatus : undefined,
    routeDistance: typeof event.routeDistance === 'number' ? event.routeDistance : undefined,
  }
}

/** Merge observation into the start-bounds candidate set; never shrink by camera clip. */
export function mergeCandidates(run: JobRun, state: unknown) {
  const mapId = readMapId(state)
  if (mapId == null || mapId !== run.boundary.startMapId) return
  for (const event of objects(isObject(state) ? state.nearbyEvents : undefined)) {
    const candidate = candidateFromEvent(event, mapId, state)
    if (!candidate) continue
    if (!inVisibleBounds(candidate.x, candidate.y, run.boundary.startVisibleBounds)) continue
    const pass = eventPassesSpec(candidate, run.spec)
    if (pass === 'exclude') {
      run.candidates.set(candidate.eventId, candidate)
      continue
    }
    run.candidates.set(candidate.eventId, pass === 'deferred' ? { ...candidate, deferred: 'uncertain_kind' } : { ...candidate, deferred: undefined })
  }
}

function reachable(candidate: Candidate) {
  return ['reachable', 'already_there', 'event_boundary'].includes(String(candidate.routeStatus || '')) && Number.isFinite(Number(candidate.routeDistance))
}

export function remainingJobs(run: JobRun): Job[] {
  const jobs: Job[] = []
  for (const candidate of run.candidates.values()) {
    if (candidate.mapId !== run.boundary.startMapId) continue
    if (!inVisibleBounds(candidate.x, candidate.y, run.boundary.startVisibleBounds)) continue
    const key = jobKey(candidate.mapId, candidate.eventId)
    if (run.ledger.has(key)) continue
    if ((run.failures.get(key) || 0) >= MAX_JOB_FAILURES) continue
    const pass = eventPassesSpec(candidate, run.spec)
    if (pass !== 'execute') continue
    if (!reachable(candidate)) continue
    jobs.push({ key, kind: 'interact', mapId: candidate.mapId, eventId: candidate.eventId })
  }
  return jobs
}

export function hasDeferred(run: JobRun) {
  for (const candidate of run.candidates.values()) {
    const key = jobKey(candidate.mapId, candidate.eventId)
    if (run.ledger.has(key)) continue
    if (eventPassesSpec(candidate, run.spec) === 'deferred') return true
  }
  return false
}

/** Prefer fewer prior failures, then shorter route distance, then smaller id. */
export function pickNext(jobs: Job[], run: JobRun): Job | null {
  if (!jobs.length) return null
  const ranked = [...jobs].sort((a, b) => {
    const failA = run.failures.get(a.key) || 0
    const failB = run.failures.get(b.key) || 0
    if (failA !== failB) return failA - failB
    const ca = run.candidates.get(a.eventId)
    const cb = run.candidates.get(b.eventId)
    const distA = Number(ca?.routeDistance)
    const distB = Number(cb?.routeDistance)
    const safeA = Number.isFinite(distA) ? distA : Number.POSITIVE_INFINITY
    const safeB = Number.isFinite(distB) ? distB : Number.POSITIVE_INFINITY
    return safeA - safeB || a.eventId - b.eventId
  })
  return ranked[0] || null
}

export function leftStartBounds(state: unknown, bounds: VisibleBounds, startMapId: number) {
  const mapId = readMapId(state)
  if (mapId != null && mapId !== startMapId) return true
  const player = readPlayerPosition(state)
  if (!player) return false
  return !inVisibleBounds(player.x, player.y, bounds)
}

export function isBattleOrOffMap(state: unknown) {
  if (!isObject(state)) return false
  if (state.battle) return true
  return typeof state.scene === 'string' && state.scene !== 'Scene_Map'
}
