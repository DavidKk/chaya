import { createLogger } from '../../../helpers/net/logger'
import { AGENT_MANUAL_INPUT_EVENT, readAgentGameState } from '../../handlers'
import type { InteractIo } from '../../interact'
import type { CompanionComplete } from '../companion-chat'
import { CompanionBanterEngine } from './story-banter'
import { StoryBattleDriver } from './story-battle'
import { isBenchmarkStoryGame } from './story-benchmark'
import { StoryContextStore } from './story-context'
import { StoryDriver } from './story-driver'
import { type ExplorationTarget, StoryExplorationPlanner } from './story-exploration'
import { StoryFailureMemory } from './story-failure-memory'
import { isStoryMenuActive, tryMapMenuHealing } from './story-menu'
import { StuckDetector } from './story-navigation'
import { type ModelThoughtEvent, StoryPuzzleSolver } from './story-puzzle-solver'

const log = createLogger('story-runtime')

export type StoryRuntimePhase = 'title' | 'dialogue' | 'choice' | 'exploring' | 'battle' | 'stuck_recovery' | 'paused' | 'idle' | 'completed' | 'thought'

export type StoryProgressUpdate = {
  phase: StoryRuntimePhase
  summary: string
  detail?: unknown
}

export type StoryRuntimeDeps = {
  complete?: CompanionComplete
  profileId?: string
  model?: string
  character?: string
  locale?: string
  goal?: string
  signal: AbortSignal
  onProgress?: (update: StoryProgressUpdate) => void
  onThought?: (thought: ModelThoughtEvent) => void
  onGameover?: () => void
}

export class CompanionStoryRuntime {
  private readonly driver: StoryDriver
  private readonly planner: StoryExplorationPlanner
  private readonly puzzleSolver: StoryPuzzleSolver
  private readonly banter: CompanionBanterEngine
  private readonly battle: StoryBattleDriver
  private readonly stuckDetector = new StuckDetector(25_000)
  private pausedUntil = 0
  private active = false
  private inBattle = false
  private lastMapId: number | null = null
  private cleanups: Array<() => void> = []
  private lastPhase: StoryRuntimePhase | null = null
  private lastSummary = ''
  private prologueMilestoneAnnounced = false
  private choiceAbort: AbortController | null = null
  private controlRevision = 0
  private runGeneration = 0
  private puzzleTargetOverride: ExplorationTarget | null = null
  private eventRunningTicks = 0
  private actionAbort: AbortController | null = null
  private readonly playerGuidance: string[] = []
  private lastTargetEventId: number | null = null
  private consecutiveTargetRepeats = 0

  constructor(private readonly deps: StoryRuntimeDeps) {
    this.battle = new StoryBattleDriver(
      (summary) => this.emit('battle', summary),
      () => this.simulateKey('ok')
    )
    const forwardThought = (thought: ModelThoughtEvent) => {
      this.deps.onThought?.(thought)
      this.emit('thought', `大模型完成推理：${thought.decision || ''}`, thought)
    }
    this.driver = new StoryDriver({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      signal: deps.signal,
      onThought: forwardThought,
    })
    this.puzzleSolver = new StoryPuzzleSolver({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      signal: deps.signal,
      onThought: forwardThought,
      onDiagnosing: () => {
        this.emit('exploring', '正在结合剧情对话与地图环境，调用大模型分析下一步主线推进策略…')
      },
    })
    this.planner = new StoryExplorationPlanner(this.puzzleSolver)
    if (deps.goal?.trim()) this.playerGuidance.push(deps.goal.trim())
    this.planner.setPlayerGuidance(this.getPlayerGuidance())
    this.banter = new CompanionBanterEngine({
      complete: deps.complete,
      profileId: deps.profileId,
      model: deps.model,
      character: deps.character,
      locale: deps.locale,
      signal: deps.signal,
      onBanter: (line) => {
        this.emit('dialogue', `旅伴说：“${line}”`)
      },
    })
  }

  private emit(phase: StoryRuntimePhase, summary: string, detail?: unknown): void {
    if (this.lastPhase === phase && this.lastSummary === summary) return
    this.lastPhase = phase
    this.lastSummary = summary
    this.deps.onProgress?.({ phase, summary, detail })
  }

  private isPreempted(): boolean {
    return Date.now() < this.pausedUntil
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  public isActive(): boolean {
    return this.active
  }

  public getPhase(): StoryRuntimePhase {
    return this.lastPhase ?? 'idle'
  }

  public getSummary(): string {
    return this.lastSummary
  }

  public applyPlayerGuidance(text: string): void {
    const clean = text.trim()
    if (!clean) return
    this.playerGuidance.push(clean)
    this.controlRevision++
    this.choiceAbort?.abort(new DOMException('Player changed instructions', 'AbortError'))
    this.actionAbort?.abort(new DOMException('Player changed instructions', 'AbortError'))
    this.puzzleTargetOverride = null
    this.stuckDetector.reset()
    this.planner.setPlayerGuidance(this.getPlayerGuidance())
    const curMapId = (globalThis as any).$gameMap?.mapId?.() ?? 0
    StoryContextStore.recordGlobalAction(curMapId, `收到玩家建议：“${clean}”`, 'guidance')
    this.emit('exploring', `收到你的建议：“${clean}”，正在调整探索决策…`)
  }

  public getPlayerGuidance(): string | null {
    return this.playerGuidance.join('\n') || null
  }

  public getChatContext(): { active: boolean; phase: string; summary: string; guidance?: string } {
    return {
      active: this.active,
      phase: this.lastPhase ?? 'exploring',
      summary: this.lastSummary,
      guidance: this.getPlayerGuidance() ?? undefined,
    }
  }

  public start(): Promise<void> {
    if (this.active) return Promise.resolve()
    this.deps.signal.throwIfAborted()
    this.active = true
    const generation = ++this.runGeneration
    const runAbort = new AbortController()
    this.actionAbort = runAbort

    // Preemption listener: manual player keys pause custody for 3s
    if (typeof window !== 'undefined') {
      const onManualInput = () => {
        this.controlRevision++
        this.choiceAbort?.abort(new DOMException('Player took control', 'AbortError'))
        this.actionAbort?.abort(new DOMException('Player took control', 'AbortError'))
        this.pausedUntil = Date.now() + 3_000
        this.emit('paused', '检测到玩家手动操作，托管暂停 3 秒…')
      }
      window.addEventListener(AGENT_MANUAL_INPUT_EVENT, onManualInput)
      this.cleanups.push(() => window.removeEventListener(AGENT_MANUAL_INPUT_EVENT, onManualInput))
    }

    return this.runLoop(generation).finally(() => {
      if (generation === this.runGeneration) this.stop()
    })
  }

  public stop(): void {
    this.active = false
    this.runGeneration++
    this.controlRevision++
    this.choiceAbort?.abort(new DOMException('Stopped', 'AbortError'))
    this.actionAbort?.abort(new DOMException('Stopped', 'AbortError'))
    this.puzzleTargetOverride = null
    this.lastTargetEventId = null
    this.consecutiveTargetRepeats = 0
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups = []
    this.emit('idle', '托管已停止')
  }

  private async runLoop(generation: number): Promise<void> {
    const g = globalThis as any
    let contextOwner = g.$gameSystem
    let lastDiagnosisAt = -Infinity
    let lastErrorKey = ''
    let lastErrorAt = 0
    let repeatedErrors = 0

    while (this.active && !this.deps.signal.aborted && generation === this.runGeneration) {
      try {
        if (contextOwner && g.$gameSystem !== contextOwner) {
          this.stop()
          this.emit('paused', '游戏存档已切换，托管已停止，请重新启动以使用新存档状态。')
          return
        }
        contextOwner = g.$gameSystem
        // 1. Handle player preemption pause
        if (this.isPreempted()) {
          await this.sleep(200)
          continue
        }
        if (this.actionAbort?.signal.aborted) this.actionAbort = new AbortController()
        const actionSignal = AbortSignal.any([this.deps.signal, this.actionAbort!.signal])

        const scene = g.SceneManager?._scene
        const sceneName = scene?.constructor?.name as string | undefined

        if (!scene) {
          await this.sleep(100)
          continue
        }

        if (sceneName === 'Scene_Gameover') {
          this.stop()
          this.emit('paused', '战斗失败，托管已停止，请选择存档后继续。')
          this.deps.onGameover?.()
          return
        }

        if (sceneName && sceneName.startsWith('Scene_') && !['Scene_Map', 'Scene_Battle', 'Scene_Title', 'Scene_Gameover'].includes(sceneName)) {
          this.emit('paused', `当前处于 ${sceneName}，等待菜单操作完成…`)
          await this.sleep(300)
          continue
        }

        if (sceneName === 'Scene_Title') {
          this.emit('title', '请从游戏菜单选择存档，读取后继续托管。')
          await this.sleep(800)
          continue
        }

        if (sceneName === 'Scene_Battle') {
          if (!this.inBattle) {
            this.inBattle = true
            this.banter.trigger('battle_start')
            const troop = g.$gameTroop
            const enemies =
              troop && typeof troop.members === 'function'
                ? (troop.members() as any[])
                    .filter((e) => e && e.isAlive?.())
                    .map((e) => e.name?.())
                    .filter(Boolean)
                : []
            const leader = g.$gameParty?.leader?.()
            const leaderHp = leader ? `我方 HP: ${leader.hp}/${leader.mhp}` : ''
            this.emit('battle', `⚔️ 遭遇战斗：${enemies.join('、') || '敌方怪物'}！(${leaderHp})`)
          }
          this.battle.step(scene)
          await this.sleep(350)
          continue
        } else if (this.inBattle) {
          this.inBattle = false
          this.banter.trigger('battle_win')
          const curMapId = g.$gameMap?.mapId?.() ?? 0
          StoryContextStore.recordGlobalAction(curMapId, '遭遇战胜利，击败敌方怪物', 'battle')
        }

        // 5. Map scene -> Dialogue, Choices & Exploration
        if (sceneName === 'Scene_Map') {
          const curMapId = g.$gameMap?.mapId?.() ?? null
          if (curMapId !== null && curMapId !== this.lastMapId) {
            const fromId = this.lastMapId
            this.lastMapId = curMapId
            this.lastTargetEventId = null
            this.consecutiveTargetRepeats = 0
            this.banter.trigger('map_transition', { mapId: curMapId })
            if (fromId !== null) {
              const player = g.$gamePlayer
              const arrivalPos = player ? { x: Number(player.x), y: Number(player.y) } : undefined
              StoryContextStore.recordTransition({
                fromMapId: fromId,
                toMapId: curMapId,
                arrivalPos,
                timestamp: Date.now(),
              })
            }
          }

          const message = g.$gameMessage
          const messageWindow = scene._messageWindow

          // 5a. Branch choices popup
          if (message && typeof message.isChoice === 'function' && message.isChoice()) {
            const choices = [...(typeof message.choices === 'function' ? message.choices() : [])] as string[]
            if (choices.length > 0) {
              const mapId = g.$gameMap?.mapId?.() ?? null
              const map = g.$gameMap
              const choiceWindow = messageWindow?._choiceWindow
              if (!choiceWindow?.active) {
                await this.sleep(50)
                continue
              }
              const revision = this.controlRevision
              const choiceContext = this.driver.getChoiceContext()
              const pending = new AbortController()
              this.choiceAbort = pending
              this.emit('choice', `决策选择中：正在仲裁分支选项 [${choices.join(' / ')}]…`)
              let pickedIdx: number
              try {
                pickedIdx = await this.driver.resolveChoice(choices, mapId, this.getPlayerGuidance(), AbortSignal.any([this.deps.signal, pending.signal]))
              } catch (error) {
                if (!pending.signal.aborted && !this.deps.signal.aborted) throw error
                continue
              } finally {
                if (this.choiceAbort === pending) this.choiceAbort = null
              }
              if (!this.active || this.deps.signal.aborted || this.isPreempted() || this.controlRevision !== revision) continue
              if (g.SceneManager?._scene !== scene || g.$gameMap !== map || g.$gameMap?.mapId?.() !== mapId || g.$gameMessage !== message) continue
              if (scene._messageWindow !== messageWindow || messageWindow?._choiceWindow !== choiceWindow || !choiceWindow?.active || !message.isChoice()) continue
              const currentChoices = message.choices()
              if (currentChoices.length !== choices.length || currentChoices.some((choice: string, index: number) => choice !== choices[index])) continue
              const currentContext = this.driver.getChoiceContext()
              if (currentContext.eventId !== choiceContext.eventId || currentContext.prompt !== choiceContext.prompt) continue
              if (pickedIdx === -2) {
                this.stop()
                this.emit('paused', '当前选项均与玩家的路线限制冲突，托管已暂停，请手动处理或调整指示。', { mapId, ...currentContext })
                return
              } else if (pickedIdx < 0) {
                const context = this.driver.getChoiceContext()
                if (context.cancelIndex >= 0 && context.cancelIndex < choices.length) {
                  if (!this.driver.applyChoiceSelection(messageWindow, context.cancelIndex)) {
                    this.stop()
                    this.emit('paused', `事件 EV${String(context.eventId).padStart(3, '0')} 的退出选项未被游戏菜单接受，托管已暂停。`, { mapId, ...context })
                    return
                  }
                  StoryFailureMemory.settleChoice(mapId ?? 0, context.eventId, false)
                  StoryFailureMemory.record(mapId ?? 0, context.eventId, 'no_effect', `Choice branches exhausted: ${context.prompt}`)
                  this.emit('thought', `事件 EV${String(context.eventId).padStart(3, '0')} 的当前分支未能推进，已通过菜单退出并记录阻碍，尝试其他路线。`)
                } else {
                  this.stop()
                  this.emit('paused', `事件 EV${String(context.eventId).padStart(3, '0')} 的当前分支已尝试且没有安全退出选项，托管已暂停。`, { mapId, ...context })
                  return
                }
              } else {
                if (!this.driver.applyChoiceSelection(messageWindow, pickedIdx)) {
                  this.stop()
                  this.emit('paused', '当前选择未被游戏菜单接受，托管已暂停，请检查选项是否可用。', { mapId, ...currentContext, pickedIdx })
                  return
                }
              }
              await this.sleep(300)
              continue
            }
          }

          // 5b. Dialogue message & map events running
          const isMsgPause = Boolean(messageWindow && messageWindow.visible && messageWindow.pause)
          const isMsgBusy = Boolean(message && typeof message.isBusy === 'function' && message.isBusy())
          const isEventRunning = Boolean(g.$gameMap && typeof g.$gameMap.isEventRunning === 'function' && g.$gameMap.isEventRunning())

          if (isMsgPause || isMsgBusy || isEventRunning) {
            if (messageWindow) {
              this.emit('dialogue', '对话推进中：等待文字显示并停顿阅读…')
              const advanced = this.driver.tickMessageWindow(messageWindow)
              if (advanced) {
                this.simulateKey('ok')
              }
            }
            if (isEventRunning && (!messageWindow || !messageWindow.visible)) {
              this.eventRunningTicks = (this.eventRunningTicks || 0) + 1
              if (this.eventRunningTicks > 5) {
                this.simulateKey('ok')
                this.eventRunningTicks = 0
              }
            } else {
              this.eventRunningTicks = 0
            }
            await this.sleep(60)
            continue
          }

          // 5d. Player free exploration
          const player = g.$gamePlayer
          const canMove = player && typeof player.canMove === 'function' ? player.canMove() : false

          if (canMove) {
            const mapId = g.$gameMap?.mapId?.() ?? 0
            const px = Number(player.x)
            const py = Number(player.y)
            const guidance = this.getPlayerGuidance()

            const settled = this.planner.settlePendingTarget()
            StoryFailureMemory.settleUnownedChoices(this.planner.pendingEventId)
            if (settled) {
              this.driver.setCurrentTargetEventId(null)
              if (!settled.result.success) {
                this.emit('thought', `⚠️ 目标【${settled.target.name || `事件 #${settled.target.eventId}`}】交互未完成，临时禁用该目标，结合剧情线索分析下一步主线推进策略…`)
                this.planner.suppressTarget(mapId, settled.target.eventId, 60_000)
                lastDiagnosisAt = Date.now()
                const puzzleTarget = await this.planner.resolvePuzzleTarget(mapId, { x: px, y: py }, this.driver.getRecentHistory(10), guidance, actionSignal)
                actionSignal.throwIfAborted()
                if (puzzleTarget) {
                  this.puzzleTargetOverride = puzzleTarget
                  this.banter.trigger('puzzle', { detail: puzzleTarget.hint })
                  this.emit('exploring', `大模型分析推理新目标：${puzzleTarget.hint || puzzleTarget.name} (${puzzleTarget.x}, ${puzzleTarget.y})…`)
                }
              }
            }
            if (isStoryMenuActive()) {
              await this.sleep(100)
              continue
            }
            await tryMapMenuHealing((summary) => this.emit('exploring', summary), actionSignal)
            actionSignal.throwIfAborted()
            if (g.SceneManager?._scene !== scene || g.$gameMap?.mapId?.() !== curMapId) continue

            // Check for prologue climax completion on Map 6
            if (isBenchmarkStoryGame() && mapId === 6) {
              const switches = g.$gameSwitches
              if (switches && (switches.value(30) || switches.value(683)) && !this.prologueMilestoneAnnounced) {
                this.prologueMilestoneAnnounced = true
                this.banter.trigger('milestone')
                StoryContextStore.recordMilestone(mapId, '🎉 序章试炼已顺利通关！')
                this.emit('exploring', '🎉 序章试炼已顺利通关！托管自律推进中，继续探索后续场景…')
              }
            }

            // Next target from exploration planner
            let target: ExplorationTarget | null = null
            if (this.puzzleTargetOverride) {
              target = this.planner.isEligible(mapId, this.puzzleTargetOverride.eventId) ? this.puzzleTargetOverride : null
              this.puzzleTargetOverride = null
            } else {
              target = this.planner.findNextTarget(mapId, { x: px, y: py }, guidance)
            }

            const isStuck = this.stuckDetector.update(mapId, px, py)
            if (!target || isStuck) {
              if (Date.now() - lastDiagnosisAt >= 15_000) {
                lastDiagnosisAt = Date.now()
                target = await this.planner.resolvePuzzleTarget(mapId, { x: px, y: py }, this.driver.getRecentHistory(10), guidance, actionSignal)
                actionSignal.throwIfAborted()
              }
              if (target) {
                this.banter.trigger('puzzle', { detail: target.hint })
                this.emit('exploring', `大模型分析推理：${target.hint || target.name} (${target.x}, ${target.y})…`)
              } else if (!target) {
                target = this.planner.findFallbackTarget(mapId, { x: px, y: py })
                if (target) {
                  this.emit('exploring', target.hint || `备选探索：调查 ${target.name}…`)
                }
              }
              this.stuckDetector.reset()
            }

            if (target) {
              if (this.lastTargetEventId === target.eventId) {
                this.consecutiveTargetRepeats = (this.consecutiveTargetRepeats || 0) + 1
              } else {
                this.consecutiveTargetRepeats = 1
                this.lastTargetEventId = target.eventId
              }

              if (this.consecutiveTargetRepeats >= 2) {
                this.emit('thought', `⚠️ 目标【${target.name || `事件 #${target.eventId}`}】重复选择 (${this.consecutiveTargetRepeats} 次)，临时禁用该目标并分析下一步推进策略…`)
                this.planner.suppressTarget(mapId, target.eventId, 60_000)
                lastDiagnosisAt = Date.now()
                const puzzleTarget = await this.planner.resolvePuzzleTarget(mapId, { x: px, y: py }, this.driver.getRecentHistory(10), guidance, actionSignal)
                actionSignal.throwIfAborted()
                if (puzzleTarget) {
                  target = puzzleTarget
                  this.puzzleTargetOverride = null
                  this.lastTargetEventId = target.eventId
                  this.consecutiveTargetRepeats = 1
                  this.banter.trigger('puzzle', { detail: target.hint })
                  this.emit('exploring', `大模型分析推理新目标：${target.hint || target.name} (${target.x}, ${target.y})…`)
                } else {
                  target = this.planner.findFallbackTarget(mapId, { x: px, y: py })
                  this.lastTargetEventId = target?.eventId ?? null
                  this.consecutiveTargetRepeats = 1
                }
              }
            }

            if (target) {
              const desc = target.hint || target.name || `事件 ${target.eventId}`
              this.emit('exploring', target.guided ? `根据你的建议：前往 ${desc} (${target.x}, ${target.y})…` : `地图探索中：前往 ${desc} (${target.x}, ${target.y})…`, {
                mapId,
                eventId: target.eventId,
                routes: this.planner.routes,
                failures: StoryFailureMemory.history(mapId),
              })
              this.driver.setCurrentTargetEventId(target.eventId)

              const io: InteractIo = {
                press: async (key) => {
                  this.simulateKey(key)
                  await this.sleep(100)
                },
                readState: readAgentGameState,
                interrupted: () => !this.active || actionSignal.aborted || this.isPreempted(),
              }

              let actionRes: any
              try {
                actionRes = await this.planner.executeTarget(target, io, actionSignal)
              } catch (error) {
                actionSignal.throwIfAborted()
                log.warn('Target interaction raised a runtime exception', { mapId, eventId: target.eventId, error })
                this.stop()
                this.emit('paused', '交互执行发生程序异常，托管已停止；请查看日志修复后继续。', {
                  mapId,
                  eventId: target.eventId,
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : undefined,
                })
                return
              } finally {
                this.driver.setCurrentTargetEventId(this.planner.pendingEventId)
              }
              if (actionRes.pending || actionRes.outcome === 'approaching' || actionRes.outcome === 'interrupted') continue
              if (!actionRes.success && !io.interrupted()) {
                log.warn('Target interaction did not complete', {
                  mapId,
                  eventId: target.eventId,
                  outcome: actionRes.outcome,
                  detail: actionRes.detail,
                })
                this.emit(
                  'thought',
                  `⚠️ 目标【${target.name || `事件 #${target.eventId}`}】交互结果与预期不一致（${actionRes.detail || actionRes.outcome}），触发大模型解谜思考分析替代路线…`
                )
                lastDiagnosisAt = Date.now()
                const puzzleTarget = await this.planner.resolvePuzzleTarget(mapId, { x: px, y: py }, this.driver.getRecentHistory(10), guidance, actionSignal)
                actionSignal.throwIfAborted()
                if (puzzleTarget) {
                  this.puzzleTargetOverride = puzzleTarget
                  this.banter.trigger('puzzle', { detail: puzzleTarget.hint })
                  this.emit('exploring', `大模型分析推理新目标：${puzzleTarget.hint || puzzleTarget.name} (${puzzleTarget.x}, ${puzzleTarget.y})…`)
                }
                await this.sleep(300)
                continue
              }
              if (actionRes.success) {
                if (target.kind === 'chest') {
                  this.banter.trigger('loot', { name: target.name || undefined })
                } else if (target.kind === 'lever') {
                  this.banter.trigger('puzzle')
                }
              }
              await this.sleep(200)
              continue
            } else {
              this.emit('paused', '当前路线暂时受阻，等待前置条件变化；失败目标保持禁用，定期分析替代路线。', {
                mapId,
                player: { x: px, y: py },
                routes: this.planner.routes,
                failures: StoryFailureMemory.history(mapId),
              })
              await this.sleep(500)
              continue
            }
          }
        }

        await this.sleep(100)
      } catch (err) {
        if (!this.active || this.deps.signal.aborted || generation !== this.runGeneration) return
        if (this.isPreempted() || this.actionAbort?.signal.aborted) continue
        log.warn('Recovering loop from exception', err)
        const errorKey = err instanceof Error ? `${err.name}:${err.message}` : String(err)
        repeatedErrors = errorKey === lastErrorKey && Date.now() - lastErrorAt < 15_000 ? repeatedErrors + 1 : 1
        lastErrorKey = errorKey
        lastErrorAt = Date.now()
        if (repeatedErrors >= 3) {
          this.stop()
          this.emit('paused', '同一运行异常连续出现，托管已停止；请查看日志后修复，避免重复执行。', { error: errorKey })
          return
        }
        await this.sleep(1000)
      }
    }
  }

  private simulateKey(key: 'ok' | 'escape' | 'cancel' | 'up' | 'down' | 'left' | 'right'): void {
    const g = globalThis as any
    const input = g.Input
    if (!input || !input._currentState) return
    input._currentState[key] = true
    input._previousState = input._previousState || {}
    input._previousState[key] = false
    input._latestButton = key
    input._pressedTime = 0
    if (key === 'escape' || key === 'cancel') {
      input._currentState['escape'] = true
      input._currentState['cancel'] = true
      input._previousState['escape'] = false
      input._previousState['cancel'] = false
    }
    setTimeout(() => {
      if (input._currentState) {
        input._currentState[key] = false
        if (key === 'escape' || key === 'cancel') {
          input._currentState['escape'] = false
          input._currentState['cancel'] = false
        }
      }
    }, 60)
  }
}
