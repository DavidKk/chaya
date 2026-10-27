/**
 * Companion Facts & Mechanics Adapter (T1).
 * Captures standard battle/action/knockout lifecycle and manages ContextStamp & GameFactsPort.
 * Follows docs/technical/companion.md and docs/technical/companion-memory.md.
 */

import type { AgentRuntimeIdentity, SourceGameEvent } from '@/lib/game-agent/audit'
import type {
  ActionGameEvent,
  BattleStartGameEvent,
  CapabilitySupport,
  CompanionDomainEvent,
  ContextStamp,
  CurrentGameFacts,
  FactEntityRef,
  FactMapInfo,
  FactSceneKind,
  FactView,
  KnockoutGameEvent,
  LoadGameEvent,
  MilestoneGameEvent,
  RuntimeScope,
  SaveGameEvent,
} from '@/lib/game-agent/companion/types'

import { hookMethod } from '../../helpers/game/method-hook'
import { readBattleCommand } from './companion-core/battle-command-binding'
import { installBattleOutcomeHooks } from './companion-facts-battle-outcomes'
import { checkGameIsPaused, currentSceneKind, detectDataRevision, generateUuid, readCurrentMapInfo } from './companion-facts-helpers'
import { call, readBoundedMechanics, readEnemyFacts, readLegalActions, readPartyFacts } from './companion-facts-mechanics'
import { captureNativeLoadRollback, clearStagedSaveMetadata, currentBattleContext, installNativeFactsHooks, popStagedSaveMetadata } from './companion-facts-native'
import { dispatchFactEvent } from './companion-facts-notify'
import { computeFactsSignature } from './companion-facts-signature'
import { companionLoadOwner } from './companion-load-context'

type Loose = Record<string, unknown>
const g = () => globalThis as unknown as Loose

export type CompanionFactsListener = (domainEvent: CompanionDomainEvent, sourceEvent: SourceGameEvent) => void

export type CompanionFactsInstance = {
  current(): FactView
  stamp(): ContextStamp
  subscribe(listener: (domainEvent: CompanionDomainEvent, sourceEvent: SourceGameEvent) => void): () => void
  readMechanics(entityRefs: FactEntityRef[]): ReturnType<typeof readBoundedMechanics>
  onSaveLifecycle(event: SaveGameEvent): void
  onLoadLifecycle(event: LoadGameEvent): void
  onMilestone(event: MilestoneGameEvent): void
  dispose(): void
}

let activeInstance: CompanionFactsInstance | null = null

export function currentCompanionFacts(): CompanionFactsInstance | null {
  return activeInstance
}

export function createCompanionFacts(identity: AgentRuntimeIdentity, producerEpoch: number): CompanionFactsInstance {
  let sourceSeq = 0
  let contextEpoch = 1
  let factsRevision = 1
  let segmentId = generateUuid('seg')
  let playthroughId = `unknown:${identity.runtimeInstanceId}`
  let currentEncounterId: string | null = null
  let activeActionId: string | null = null
  let actionResultCount = 0
  let lastSignature = ''
  const observedSkillIds = new Set<number>()

  const listeners = new Set<CompanionFactsListener>()
  const unhooks: Array<() => void> = []

  const scope = (): RuntimeScope => ({
    libraryGameId: identity.libraryGameId,
    dataRevision: detectDataRevision(identity.runtimeInstanceId),
    playthroughId,
    runtimeInstanceId: identity.runtimeInstanceId,
    segmentId,
  })

  const stamp = (): ContextStamp => ({
    scope: scope(),
    contextEpoch,
    factsRevision,
  })

  function notify(domainEvent: CompanionDomainEvent) {
    sourceSeq += 1
    factsRevision += 1
    dispatchFactEvent(domainEvent, identity, producerEpoch, sourceSeq, listeners)
  }

  function readCurrent(): FactView {
    const w = g()
    const { kind: rawSceneKind, rawName: rawSceneName } = currentSceneKind()
    const inBattleFlag = Boolean(call<boolean>(w.$gameParty, 'inBattle'))
    const isActuallyInBattle = Boolean(currentEncounterId || inBattleFlag || rawSceneKind === 'battle')
    const sceneKind: FactSceneKind = isActuallyInBattle ? 'battle' : rawSceneKind

    const mapInfo: FactMapInfo = readCurrentMapInfo()
    const party = readPartyFacts()
    const enemies = isActuallyInBattle ? readEnemyFacts() : []
    const legalActions = isActuallyInBattle ? readLegalActions() : []
    const isPaused = checkGameIsPaused()

    const current: CurrentGameFacts = {
      scene: { value: sceneKind, known: true, sourceRefs: ['SceneManager._scene', '$gameParty.inBattle'] },
      rawSceneName,
      map: { value: mapInfo, known: mapInfo.mapId > 0, sourceRefs: ['$gameMap'] },
      encounterId: { value: currentEncounterId, known: currentEncounterId !== null, sourceRefs: ['BattleManager'] },
      party: { value: party, known: party.length > 0, sourceRefs: ['$gameParty'] },
      enemies: { value: enemies, known: isActuallyInBattle, sourceRefs: ['$gameTroop'] },
      legalActions: { value: legalActions, known: isActuallyInBattle, sourceRefs: ['$gameParty'] },
      isPaused,
    }

    const currentSig = computeFactsSignature(current)
    if (lastSignature && currentSig !== lastSignature) {
      factsRevision += 1
    }
    lastSignature = currentSig

    const capabilities: Record<string, CapabilitySupport> = {
      'game.facts': 'supported',
      'battle.standard': 'supported',
      'battle.script_rgss': 'unsupported',
      'save.lifecycle': 'supported',
      'mechanics.reflection_dot': 'partial',
      'runtime.pause': 'partial',
    }

    return {
      stamp: stamp(),
      capabilities,
      current,
      mechanics: readBoundedMechanics(legalActions, observedSkillIds, party, enemies),
    }
  }

  // Install native hooks (setupNewGame, makeSaveContents, extractSaveContents, saveGame, reflection)
  unhooks.push(
    ...installNativeFactsHooks({
      currentScope: scope,
      currentEpoch: () => contextEpoch,
      onNewGame: (newPlaythrough, newSeg) => {
        playthroughId = newPlaythrough
        segmentId = newSeg
        currentEncounterId = null
        activeActionId = null
        observedSkillIds.clear()
        lastSignature = ''
        contextEpoch += 1
        factsRevision += 1
      },
      onSaveLifecycle: (event) => {
        notify(event)
      },
    })
  )

  const w = g()
  const battle = w.BattleManager as Loose | undefined

  if (battle) {
    unhooks.push(
      hookMethod(
        battle,
        'startAction',
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            activeActionId = generateUuid('act')
            actionResultCount = 0
            return original.apply(this, args)
          }
      )
    )
  }

  const actionProto = (w.Game_Action as Loose | undefined)?.prototype as Loose | undefined
  if (actionProto) {
    unhooks.push(
      hookMethod(
        actionProto,
        'apply',
        (original) =>
          function (this: unknown, target: unknown) {
            const targetObj = target as Loose | undefined
            let hpBefore: number | null = null
            let hpMax: number | undefined
            let stateIdsBefore: number[] = []

            try {
              if (typeof targetObj?.hp === 'number') hpBefore = targetObj.hp
              if (typeof targetObj?.mhp === 'number') hpMax = targetObj.mhp
              const states = call<Loose[]>(targetObj, 'states')
              if (Array.isArray(states)) {
                stateIdsBefore = states.map((s) => Number(s?.id || 0))
              }
            } catch {}

            const result = original.apply(this, [target])

            try {
              const hpAfter = typeof targetObj?.hp === 'number' ? targetObj.hp : null
              const actionRes = call<Loose>(targetObj, 'result')
              const reportedHpDamage = actionRes && typeof actionRes.hpDamage === 'number' ? actionRes.hpDamage : null
              const item = call<Loose>(this, 'item')
              const subject = call<Loose>(this, 'subject')

              let stateIdsAfter: number[] = []
              const statesPost = call<Loose[]>(targetObj, 'states')
              if (Array.isArray(statesPost)) {
                stateIdsAfter = statesPost.map((s) => Number(s?.id || 0))
              }

              if (!activeActionId) {
                activeActionId = generateUuid('act')
                actionResultCount = 0
              }
              actionResultCount += 1
              const resultId = `${activeActionId}:res-${actionResultCount}`

              const isSubjectEnemy = Boolean(call<boolean>(subject, 'isEnemy'))
              const isSubjectActor = Boolean(call<boolean>(subject, 'isActor'))
              const isTargetEnemy = Boolean(call<boolean>(targetObj, 'isEnemy'))

              const battleContext = currentBattleContext()
              const isReflected = battleContext === 'reflection'
              const isCountered = battleContext === 'counter'

              let sourceKind: 'actor' | 'enemy' | 'unknown'
              let sourceInstance: string
              let sourceId: number | undefined

              if (isReflected || isCountered) {
                sourceKind = 'unknown'
                sourceInstance = isReflected ? 'unknown:magic_reflection' : 'unknown:counter_attack'
                sourceId = undefined
              } else if (isSubjectEnemy) {
                sourceKind = 'enemy'
                sourceId = call<number>(subject, 'enemyId')
                const sourceIndex = call<number>(subject, 'index') ?? 0
                sourceInstance = `enemy:${sourceIndex}`
              } else if (isSubjectActor) {
                sourceKind = 'actor'
                sourceId = call<number>(subject, 'actorId')
                sourceInstance = `actor:${sourceId}`
              } else {
                sourceKind = 'unknown'
                sourceInstance = 'unknown:environment'
              }

              const targetKind: 'actor' | 'enemy' = isTargetEnemy ? 'enemy' : 'actor'
              const targetId = isTargetEnemy ? (call<number>(targetObj, 'enemyId') ?? 0) : (call<number>(targetObj, 'actorId') ?? 0)
              const targetIndex = call<number>(targetObj, 'index') ?? 0
              const targetInstance = isTargetEnemy ? `enemy:${targetIndex}` : `actor:${targetId}`

              const isItemCall = Boolean(call<boolean>(this, 'isItem'))
              const abilityKind: 'skill' | 'item' = isItemCall ? 'item' : 'skill'
              const itemId = Number(item?.id || 0)
              if (itemId > 0 && abilityKind === 'skill') {
                observedSkillIds.add(itemId)
                if (observedSkillIds.size > 128) observedSkillIds.delete(observedSkillIds.values().next().value!)
              }

              const attribution: 'observed_action' | 'unknown' = sourceKind === 'unknown' ? 'unknown' : 'observed_action'

              const actionEv: ActionGameEvent = {
                kind: 'action',
                commandId: attribution === 'observed_action' ? readBattleCommand(this as object, currentEncounterId, stamp()) : undefined,
                actionId: activeActionId,
                resultId,
                source: {
                  kind: sourceKind,
                  id: sourceId,
                  instance: sourceInstance,
                },
                target: {
                  kind: targetKind,
                  id: targetId,
                  instance: targetInstance,
                },
                ability: item
                  ? {
                      kind: abilityKind,
                      id: itemId,
                      name: item.name ? String(item.name) : undefined,
                    }
                  : undefined,
                hpBefore,
                hpAfter,
                reportedHpDamage,
                hpMax,
                stateIdsBefore,
                stateIdsAfter,
                attribution,
                encounterId: currentEncounterId || undefined,
                at: Date.now(),
              }

              notify(actionEv)

              const isKnockout = (hpBefore != null && hpBefore > 0 && hpAfter === 0) || (!stateIdsBefore.includes(1) && stateIdsAfter.includes(1))

              if (isKnockout) {
                const knockoutEv: KnockoutGameEvent = {
                  kind: 'knockout',
                  target: actionEv.target,
                  killer: actionEv.source,
                  lethalActionId: activeActionId,
                  lethalAbility: actionEv.ability,
                  encounterId: currentEncounterId || undefined,
                  at: Date.now(),
                }
                notify(knockoutEv)
              }
            } catch (e) {
              console.error('[CompanionFacts] Error observing Game_Action.apply:', e)
            }

            return result
          }
      )
    )
  }

  if (battle) {
    unhooks.push(
      hookMethod(
        battle,
        'setup',
        (original) =>
          function (this: unknown, troopId: unknown, canLose: unknown, canEscape: unknown) {
            currentEncounterId = generateUuid('encounter')
            activeActionId = null
            const ret = original.apply(this, [troopId, canLose, canEscape])

            const troops = w.$dataTroops as Array<Loose | null> | undefined
            const trId = Number(troopId)
            const troopObj = troops?.[trId]
            const troopName = troopObj?.name ? String(troopObj.name) : undefined
            const troopMembers = call<Loose[]>(w.$gameTroop, 'members') ?? []
            const enemyIds = troopMembers.map((m) => Number(call<number>(m, 'enemyId') ?? m?.enemyId ?? 0)).filter((id) => id > 0)

            const startEv: BattleStartGameEvent = {
              kind: 'battle_start',
              encounterId: currentEncounterId,
              troopId: Number.isFinite(trId) && trId > 0 ? trId : undefined,
              troopName,
              enemyIds,
              at: Date.now(),
            }
            notify(startEv)

            return ret
          }
      )
    )

    unhooks.push(
      hookMethod(
        battle,
        'endAction',
        (original) =>
          function (this: unknown, ...args: unknown[]) {
            activeActionId = null
            return original.apply(this, args)
          }
      )
    )

    unhooks.push(
      ...installBattleOutcomeHooks(
        battle,
        () => currentEncounterId,
        () => {
          currentEncounterId = null
        },
        notify
      )
    )
  }
  const dm = w.DataManager as Loose | undefined
  if (dm) {
    unhooks.push(
      hookMethod(
        dm,
        'loadGame',
        (original) =>
          function (this: unknown, slot: unknown) {
            const opId = generateUuid('native-load')
            const fromSeg = segmentId
            const fromScp = scope()
            const fromEncounter = currentEncounterId
            const rollbackGlobals = captureNativeLoadRollback()
            const initiatorTaskId = companionLoadOwner()

            contextEpoch += 1
            const loadEpoch = contextEpoch
            currentEncounterId = null
            activeActionId = null
            clearStagedSaveMetadata()
            const beginEv: LoadGameEvent = {
              kind: 'load',
              operationId: opId,
              phase: 'begin',
              saveSlot: typeof slot === 'number' || typeof slot === 'string' ? slot : undefined,
              saveKind: 'native',
              fromSegmentId: fromSeg,
              fromScope: fromScp,
              initiatorTaskId,
              at: Date.now(),
            }
            notify(beginEv)

            const handleResult = (ok: boolean) => {
              if (ok) {
                segmentId = generateUuid('seg')
                const stagedMeta = popStagedSaveMetadata()
                if (stagedMeta && stagedMeta.playthroughId) {
                  playthroughId = stagedMeta.playthroughId
                } else {
                  playthroughId = generateUuid('unknown-playthrough')
                }
                const toScp = scope()
                const commitEv: LoadGameEvent = {
                  kind: 'load',
                  operationId: opId,
                  phase: 'commit',
                  saveSlot: typeof slot === 'number' || typeof slot === 'string' ? slot : undefined,
                  saveKind: 'native',
                  fromSegmentId: fromSeg,
                  toSegmentId: segmentId,
                  fromScope: fromScp,
                  toScope: toScp,
                  initiatorTaskId,
                  origin: stagedMeta ? 'verified_metadata' : 'linked_load_context',
                  at: Date.now(),
                }
                notify(commitEv)
              } else {
                if (contextEpoch === loadEpoch) {
                  rollbackGlobals()
                  currentEncounterId = fromEncounter
                }
                contextEpoch += 1
                popStagedSaveMetadata()
                const rollbackEv: LoadGameEvent = {
                  kind: 'load',
                  operationId: opId,
                  phase: 'rollback',
                  saveSlot: typeof slot === 'number' || typeof slot === 'string' ? slot : undefined,
                  saveKind: 'native',
                  fromSegmentId: fromSeg,
                  fromScope: fromScp,
                  initiatorTaskId,
                  at: Date.now(),
                }
                notify(rollbackEv)
              }
            }

            let res: unknown
            try {
              res = original.apply(this, [slot])
            } catch (err) {
              handleResult(false)
              throw err
            }

            if (res && typeof (res as Promise<unknown>).then === 'function') {
              return (res as Promise<unknown>).then(
                (r) => {
                  const ok = r !== false
                  handleResult(ok)
                  return r
                },
                (err) => {
                  handleResult(false)
                  return Promise.reject(err)
                }
              )
            }

            handleResult(res !== false)
            return res
          }
      )
    )
  }
  const instance: CompanionFactsInstance = {
    stamp,
    current(): FactView {
      return readCurrent()
    },
    subscribe(listener: (domainEvent: CompanionDomainEvent, sourceEvent: SourceGameEvent) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    readMechanics(entityRefs: FactEntityRef[]) {
      return readBoundedMechanics(readLegalActions(), observedSkillIds, readPartyFacts(), readEnemyFacts(), entityRefs)
    },
    onSaveLifecycle(event: SaveGameEvent) {
      notify(event)
    },
    onLoadLifecycle(event: LoadGameEvent) {
      if (event.phase === 'begin') {
        contextEpoch += 1
        currentEncounterId = null
        activeActionId = null
      } else if (event.phase === 'commit') {
        segmentId = event.toSegmentId || generateUuid('seg')
        if (event.toScope?.playthroughId) {
          playthroughId = event.toScope.playthroughId
        }
      } else if (event.phase === 'rollback') {
        contextEpoch += 1
      }
      notify(event)
    },
    onMilestone(event: MilestoneGameEvent) {
      notify(event)
    },
    dispose() {
      for (const undo of unhooks) {
        try {
          undo()
        } catch {}
      }
      unhooks.length = 0
      listeners.clear()
      if (activeInstance === instance) activeInstance = null
    },
  }

  activeInstance = instance
  return instance
}
