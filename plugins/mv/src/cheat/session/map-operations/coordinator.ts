import { IdempotentWriteCache, type OperationIdentity } from '@/lib/runtime/recoverable-operation'

export type MapOperationKind = 'single' | 'batch' | 'undo'
export type MapOperationStatus = {
  operationId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  kind: MapOperationKind
  completed: number
  failed: number
  skipped: number
  error?: string
  items: Array<{ label: string; state: 'completed' | 'failed' | 'skipped' | 'unknown'; error?: string }>
}

export type MapOperationItemResult<T> = { state: 'completed'; value: T; startedAutomatic?: boolean } | { state: 'failed'; error: string } | { state: 'unknown'; error: string }

export type UndoValue = { key: string; before: unknown; after: unknown }
export type UndoStep = { id: string; summary: string; values: UndoValue[] }
export type UndoConflict = UndoValue & { current: unknown }
export type UndoResult = { status: MapOperationStatus; conflicts: UndoConflict[]; remaining: number }
export type UndoAdapter = {
  read(key: string): Promise<unknown> | unknown
  write(key: string, value: unknown): Promise<void> | void
}

export class MapOperationBusyError extends Error {
  constructor() {
    super('已有地图操作正在执行，请等待其结束')
    this.name = 'MapOperationBusyError'
  }
}

export class MapOperationCoordinator {
  private active: MapOperationStatus | null = null
  private readonly recent = new Map<string, MapOperationStatus>()
  private readonly writes = new IdempotentWriteCache<MapOperationStatus>(200)
  private readonly undoSteps: UndoStep[] = []

  status(operationId?: string): MapOperationStatus | null {
    if (!operationId) return this.active
    return this.active?.operationId === operationId ? this.active : (this.recent.get(operationId) ?? null)
  }

  undoStack(): readonly UndoStep[] {
    return this.undoSteps
  }

  latestUndo(): UndoStep | null {
    return this.undoSteps.at(-1) ?? null
  }

  recordUndo(step: UndoStep): void {
    if (!step.values.length) return
    if (this.undoSteps.some((candidate) => candidate.id === step.id)) return
    this.undoSteps.push(step)
    if (this.undoSteps.length > 10) this.undoSteps.splice(0, this.undoSteps.length - 10)
  }

  discardUndo(stepId: string): void {
    const index = this.undoSteps.findIndex((step) => step.id === stepId)
    if (index >= 0) this.undoSteps.splice(index, 1)
  }

  async inspectUndo(adapter: Pick<UndoAdapter, 'read'>, stepId?: string): Promise<{ step: UndoStep; conflicts: UndoConflict[] }> {
    const step = stepId ? this.undoSteps.find((candidate) => candidate.id === stepId) : this.latestUndo()
    if (!step) throw new Error('没有可撤销的地图操作')
    const conflicts: UndoConflict[] = []
    for (const value of step.values) {
      const current = await adapter.read(value.key)
      if (!sameValue(current, value.after)) conflicts.push({ ...value, current })
    }
    return { step, conflicts }
  }

  async undo(identity: OperationIdentity, adapter: UndoAdapter, options?: { stepId?: string; force?: boolean }): Promise<UndoResult> {
    const inspected = await this.inspectUndo(adapter, options?.stepId)
    if (inspected.conflicts.length && !options?.force) {
      const status: MapOperationStatus = {
        operationId: identity.requestId,
        state: 'failed',
        kind: 'undo',
        completed: 0,
        failed: inspected.conflicts.length,
        skipped: 0,
        items: inspected.conflicts.map((value) => ({ label: value.key, state: 'failed', error: '当前值与操作后的值不一致' })),
        error: '撤销内容已被游戏修改，请确认冲突后重试',
      }
      return { status, conflicts: inspected.conflicts, remaining: inspected.step.values.length }
    }
    const step = inspected.step
    const restored = new Set<string>()
    const ordered = [...step.values].reverse().sort((left, right) => Number(left.key === 'playerPosition') - Number(right.key === 'playerPosition'))
    const status = await this.run(identity, 'undo', ordered, async (value) => {
      try {
        await adapter.write(value.key, value.before)
        const current = await adapter.read(value.key)
        if (!sameValue(current, value.before)) return { state: 'failed', error: `撤销后校验失败：${value.key}` }
        restored.add(value.key)
        return { state: 'completed', value: current }
      } catch (error) {
        return { state: 'failed', error: error instanceof Error ? error.message : String(error) }
      }
    })
    if (restored.size) step.values = step.values.filter((value) => !restored.has(value.key))
    if (!step.values.length) this.discardUndo(step.id)
    return { status, conflicts: inspected.conflicts, remaining: step.values.length }
  }

  run<T>(
    identity: OperationIdentity,
    kind: MapOperationKind,
    items: readonly T[],
    execute: (item: T, index: number) => Promise<MapOperationItemResult<unknown>>,
    label: (item: T, index: number) => string = (_item, index) => `#${index + 1}`
  ): Promise<MapOperationStatus> {
    return this.writes.run(identity, async () => {
      if (this.active) throw new MapOperationBusyError()
      if (kind === 'batch' && items.length > 50) throw new Error('批量操作最多 50 项')
      const status: MapOperationStatus = { operationId: identity.requestId, state: 'running', kind, completed: 0, failed: 0, skipped: 0, items: [] }
      this.active = status
      try {
        for (let index = 0; index < items.length; index++) {
          const result = await execute(items[index], index)
          if (result.state === 'completed') {
            status.completed++
            status.items.push({ label: label(items[index], index), state: 'completed' })
            if (result.startedAutomatic) {
              for (let skipped = index + 1; skipped < items.length; skipped++) {
                status.skipped++
                status.items.push({ label: label(items[skipped], skipped), state: 'skipped', error: '自动执行事件已开始' })
              }
              break
            }
            continue
          }
          status.failed++
          status.error = result.error
          status.items.push({ label: label(items[index], index), state: result.state, error: result.error })
          if (result.state === 'unknown') {
            status.state = 'unknown'
            for (let skipped = index + 1; skipped < items.length; skipped++) {
              status.skipped++
              status.items.push({ label: label(items[skipped], skipped), state: 'skipped', error: '前一项结果未知' })
            }
            return { ...status }
          }
          if (kind === 'undo') break
        }
        status.state = status.failed ? 'failed' : 'completed'
        return { ...status }
      } catch (error) {
        status.state = error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed'
        status.error = error instanceof Error ? error.message : String(error)
        return { ...status }
      } finally {
        this.remember({ ...status })
        this.active = null
      }
    })
  }

  private remember(status: MapOperationStatus): void {
    this.recent.set(status.operationId, status)
    if (this.recent.size <= 200) return
    const first = this.recent.keys().next().value
    if (first) this.recent.delete(first)
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
