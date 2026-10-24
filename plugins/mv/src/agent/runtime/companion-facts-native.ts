/**
 * Native RPG Maker DataManager & Battle Reflection Hooks.
 * - setupNewGame: establishes a fresh playthrough UUID & new segment.
 * - makeSaveContents: writes namespaced _chayaCompanion metadata (schemaVersion: 1).
 * - extractSaveContents: validates and stages metadata without mutating current scope.
 * - saveGame: manages begin -> commit / rollback save lifecycle.
 * - Battle reflection: marks reflection/counter contexts so knockouts are not misattributed.
 */

import type { RuntimeScope, SaveGameEvent } from '@/lib/game-agent/companion/types'

import { hookMethod } from '../../helpers/game/method-hook'
import { generateUuid } from './companion-facts-helpers'

type Loose = Record<string, unknown>
const g = () => globalThis as unknown as Loose

export function captureNativeLoadRollback(): () => void {
  const world = g()
  const keys = [
    '$gameTemp',
    '$gameSystem',
    '$gameScreen',
    '$gameTimer',
    '$gameMessage',
    '$gameSwitches',
    '$gameVariables',
    '$gameSelfSwitches',
    '$gameActors',
    '$gameParty',
    '$gameTroop',
    '$gameMap',
    '$gamePlayer',
  ]
  const previous = keys.map((key) => [key, world[key]] as const)
  return () => {
    for (const [key, value] of previous) world[key] = value
  }
}

export type StagedSaveMetadata = {
  schemaVersion: 1
  libraryGameId: string
  dataRevision: string
  playthroughId: string
  segmentId: string
  contextEpoch: number
  savedAt: number
}

let stagedSaveMetadata: StagedSaveMetadata | null = null
let activeBattleContext: 'normal' | 'reflection' | 'counter' = 'normal'

export function currentBattleContext(): 'normal' | 'reflection' | 'counter' {
  return activeBattleContext
}

export function popStagedSaveMetadata(): StagedSaveMetadata | null {
  const meta = stagedSaveMetadata
  stagedSaveMetadata = null
  return meta
}

export function clearStagedSaveMetadata(): void {
  stagedSaveMetadata = null
}

export type NativeFactsHooksCallbacks = {
  currentScope: () => RuntimeScope
  currentEpoch: () => number
  onNewGame: (newPlaythroughId: string, newSegmentId: string) => void
  onSaveLifecycle: (event: SaveGameEvent) => void
}

export function installNativeFactsHooks(callbacks: NativeFactsHooksCallbacks): Array<() => void> {
  const w = g()
  const unhooks: Array<() => void> = []

  const dm = w.DataManager as Loose | undefined
  if (dm) {
    // 1. setupNewGame
    unhooks.push(
      hookMethod(
        dm,
        'setupNewGame',
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            const newPlaythroughId = generateUuid('playthrough')
            const newSegmentId = generateUuid('seg')
            callbacks.onNewGame(newPlaythroughId, newSegmentId)
            return original.apply(this, args)
          }
      )
    )

    // 2. makeSaveContents
    unhooks.push(
      hookMethod(
        dm,
        'makeSaveContents',
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            const contents = original.apply(this, args) as Loose | undefined
            if (contents && typeof contents === 'object') {
              const scope = callbacks.currentScope()
              contents._chayaCompanion = {
                schemaVersion: 1,
                libraryGameId: scope.libraryGameId,
                dataRevision: scope.dataRevision,
                playthroughId: scope.playthroughId,
                segmentId: scope.segmentId,
                contextEpoch: callbacks.currentEpoch(),
                savedAt: Date.now(),
              } satisfies StagedSaveMetadata
            }
            return contents
          }
      )
    )

    // 3. extractSaveContents - strictly stage, never mutate active scope immediately
    unhooks.push(
      hookMethod(
        dm,
        'extractSaveContents',
        (original) =>
          function (this: unknown, contents: unknown) {
            const ret = original.apply(this, [contents])
            try {
              stagedSaveMetadata = null
              const rawMeta = (contents as Loose | undefined)?._chayaCompanion as Loose | undefined
              if (
                rawMeta &&
                rawMeta.schemaVersion === 1 &&
                typeof rawMeta.libraryGameId === 'string' &&
                rawMeta.libraryGameId.trim().length > 0 &&
                rawMeta.libraryGameId.length <= 128 &&
                typeof rawMeta.dataRevision === 'string' &&
                rawMeta.dataRevision.trim().length > 0 &&
                rawMeta.dataRevision.length <= 128 &&
                typeof rawMeta.playthroughId === 'string' &&
                rawMeta.playthroughId.trim().length > 0 &&
                rawMeta.playthroughId.length <= 128 &&
                typeof rawMeta.segmentId === 'string' &&
                rawMeta.segmentId.trim().length > 0 &&
                typeof rawMeta.contextEpoch === 'number' &&
                typeof rawMeta.savedAt === 'number'
              ) {
                const currentScope = callbacks.currentScope()
                if (rawMeta.libraryGameId === currentScope.libraryGameId && rawMeta.dataRevision === currentScope.dataRevision) {
                  stagedSaveMetadata = {
                    schemaVersion: 1,
                    libraryGameId: rawMeta.libraryGameId,
                    dataRevision: rawMeta.dataRevision,
                    playthroughId: rawMeta.playthroughId,
                    segmentId: rawMeta.segmentId,
                    contextEpoch: rawMeta.contextEpoch,
                    savedAt: rawMeta.savedAt,
                  }
                }
              }
            } catch {
              stagedSaveMetadata = null
            }
            return ret
          }
      )
    )

    // 4. saveGame - handles both synchronous (MV) and Promise-based (MZ)
    unhooks.push(
      hookMethod(
        dm,
        'saveGame',
        (original) =>
          function (this: unknown, slot: unknown) {
            const opId = generateUuid('native-save')
            const saveSlot = typeof slot === 'number' || typeof slot === 'string' ? slot : undefined

            callbacks.onSaveLifecycle({
              kind: 'save',
              operationId: opId,
              phase: 'begin',
              saveKind: 'native',
              saveSlot,
              at: Date.now(),
            })

            const handleSaveResult = (ok: boolean) => {
              if (ok) {
                callbacks.onSaveLifecycle({
                  kind: 'save',
                  operationId: opId,
                  phase: 'commit',
                  saveKind: 'native',
                  saveSlot,
                  at: Date.now(),
                })
              } else {
                callbacks.onSaveLifecycle({
                  kind: 'save',
                  operationId: opId,
                  phase: 'rollback',
                  saveKind: 'native',
                  saveSlot,
                  at: Date.now(),
                })
              }
            }

            let res: unknown
            try {
              res = original.apply(this, [slot])
            } catch (err) {
              handleSaveResult(false)
              throw err
            }

            if (res && typeof (res as Promise<unknown>).then === 'function') {
              return (res as Promise<unknown>).then(
                (r) => {
                  const ok = r !== false
                  handleSaveResult(ok)
                  return r
                },
                (err) => {
                  handleSaveResult(false)
                  return Promise.reject(err)
                }
              )
            }

            handleSaveResult(res !== false)
            return res
          }
      )
    )
  }

  // 5. BattleManager reflection & counter context tracking
  const bm = w.BattleManager as Loose | undefined
  if (bm) {
    unhooks.push(
      hookMethod(
        bm,
        'invokeMagicReflection',
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            const prev = activeBattleContext
            activeBattleContext = 'reflection'
            try {
              return original.apply(this, args)
            } finally {
              activeBattleContext = prev
            }
          }
      )
    )

    unhooks.push(
      hookMethod(
        bm,
        'invokeCounterAttack',
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            const prev = activeBattleContext
            activeBattleContext = 'counter'
            try {
              return original.apply(this, args)
            } finally {
              activeBattleContext = prev
            }
          }
      )
    )
  }

  return unhooks
}
