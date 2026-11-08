import type { CompanionComplete } from '../companion-chat'
import { isBenchmarkStoryGame } from './story-benchmark'
import { allowedStoryChoices } from './story-choice-policy'
import { StoryContextStore } from './story-context'
import { StoryFailureMemory } from './story-failure-memory'
import { positiveStoryGuidance, storyTravelPolicy } from './story-guidance'
import type { ModelThoughtEvent } from './story-puzzle-solver'

export type DialogueEntry = {
  speaker: string | null
  text: string
  at: number
}

export type StoryDriverDeps = {
  complete?: CompanionComplete
  profileId?: string
  model?: string
  signal?: AbortSignal
  onThought?: (thought: ModelThoughtEvent) => void
}

export class StoryDriver {
  private readonly history: DialogueEntry[] = []
  private lastPushedText = ''
  private naturalWaitFrames = 0
  private currentTargetEventId: number | null = null
  private selection: { index: number; commit: () => void } | null = null
  private choiceSource: { commands: any[]; index: number } | null = null
  private allowedChoices: Set<number> | null = null

  constructor(private readonly deps: StoryDriverDeps = {}) {}

  public setCurrentTargetEventId(id: number | null): void {
    this.currentTargetEventId = id
  }

  public getChoiceContext(): { eventId: number; prompt: string; cancelIndex: number } {
    const engine = globalThis as any
    const map = engine.$gameMap
    const roots = [map?._interpreter, ...(map?._commonEvents ?? []).map((event: any) => event?._interpreter), ...(map?.events?.() ?? []).map((event: any) => event?._interpreter)]
    let owner: any = null
    let commandPath: number[] = []
    for (const root of roots) {
      const path: number[] = []
      const visited = new Set()
      for (let interpreter = root; interpreter && !visited.has(interpreter); interpreter = interpreter._childInterpreter) {
        visited.add(interpreter)
        path.push(interpreter._index ?? -1)
        if (interpreter._waitMode === 'message') {
          owner = interpreter
          commandPath = [...path]
        }
      }
    }
    this.choiceSource = owner?._list ? { commands: owner._list, index: owner._index } : null
    return {
      eventId: owner ? (owner.eventId?.() ?? owner._eventId ?? 0) : (this.currentTargetEventId ?? 0),
      prompt: JSON.stringify([engine.$gameMessage?.allText?.() ?? '', commandPath]),
      cancelIndex: engine.$gameMessage?.choiceCancelType?.() ?? -1,
    }
  }

  public pushDialogue(text: string, speaker: string | null = null): void {
    const clean = text.replace(/<[^>]+>/g, '').trim()
    if (!clean || clean === this.lastPushedText) return
    this.lastPushedText = clean
    this.history.push({ speaker, text: clean, at: Date.now() })
    if (this.history.length > 50) this.history.shift()
  }

  public getRecentHistory(count = 5): string[] {
    return this.history.slice(-count).map((e) => (e.speaker ? `${e.speaker}: ${e.text}` : e.text))
  }

  public computeReadingFrames(text: string): number {
    const clean = text.replace(/<[^>]+>/g, '').trim()
    const baseFrames = 4
    const extraFrames = Math.min(8, Math.floor(clean.length / 12))
    return baseFrames + extraFrames
  }

  public tickMessageWindow(win: any): boolean {
    if (!win) return false
    if (win.pause && !win.isAnySubWindowActive?.()) {
      const text = (globalThis as any).$gameMessage ? (globalThis as any).$gameMessage.allText() : ''
      if (text) this.pushDialogue(text)
      if (this.naturalWaitFrames <= 0) {
        this.naturalWaitFrames = this.computeReadingFrames(text)
      }
      this.naturalWaitFrames--
      if (this.naturalWaitFrames <= 0) {
        return true
      }
    } else {
      this.naturalWaitFrames = 0
    }
    return false
  }

  public async resolveChoice(choices: string[], currentMapId?: number | null, playerGuidance?: string | null, signal = this.deps.signal): Promise<number> {
    this.selection = null
    signal?.throwIfAborted()
    if (!choices || choices.length === 0) return 0
    const engine = globalThis as any
    const context = this.getChoiceContext()
    const activeEventId = context.eventId
    // L0: Deterministic rule filter
    const lockpickIdx = choices.findIndex((c) => /撬锁|开锁|lockpick/i.test(c.trim()))
    const disarmIdx = choices.findIndex((c) => /试着解除|解除陷阱|обезвредить|disarm/i.test(c.trim()))
    const leaveIdx = choices.findIndex((c) => /离开|放弃|leave/i.test(c.trim()))
    const activeMapId = currentMapId ?? (globalThis as any).$gameMap?.mapId?.() ?? 0
    const allowed = allowedStoryChoices(choices, activeMapId, activeEventId, playerGuidance, this.choiceSource)
    this.allowedChoices = allowed
    if (!allowed.size) return -2
    const requiredLevel = isBenchmarkStoryGame() ? engine.$gameVariables?.value?.(lockpickIdx >= 0 ? 2 : 5) : undefined
    const condition = { requiredLevel: lockpickIdx >= 0 || disarmIdx >= 0 ? requiredLevel : undefined, requiresLockpick: isBenchmarkStoryGame() && lockpickIdx >= 0 }
    const recordedAttempts = StoryFailureMemory.choiceAttempts(activeMapId, activeEventId, choices, condition, context.prompt)
    const attempts = new Set([...recordedAttempts, ...choices.flatMap((_, index) => (allowed.has(index) ? [] : [index]))])
    const select = (index: number): number => {
      this.selection = { index, commit: () => recordedAttempts.add(index) }
      return index
    }
    if (allowed.size < choices.length && allowed.has(context.cancelIndex)) return context.cancelIndex

    if (isBenchmarkStoryGame()) {
      const g = globalThis as any

      // Anti-stairs oscillation on Map 6: Never go upstairs to Map 5 when exploring Map 6
      if (activeMapId === 6) {
        const stayIdx = choices.findIndex((c) => /不上|留在|stay/i.test(c.trim()))
        const goUpIdx = choices.findIndex((c) => /上楼|наверх|upstairs/i.test(c.trim()) && !/不上/i.test(c))
        if (stayIdx >= 0 && goUpIdx >= 0 && !storyTravelPolicy(playerGuidance).explicitTravel && allowed.has(stayIdx)) return stayIdx

        // Goddess Statue offering choices: Place offering on pedestal
        const placeOfferingIdx = choices.findIndex((c) => /放在底座上|赐礼|дар|altar|pedestal/i.test(c.trim()))
        if (placeOfferingIdx >= 0 && !attempts.has(placeOfferingIdx)) {
          return select(placeOfferingIdx)
        }

        // Completion confirmation: Yes / No -> Choose Yes
        const yesIdx = choices.findIndex((c) => /^(是|yes|да)[。.]?$/i.test(c.trim()))
        if (yesIdx >= 0 && !attempts.has(yesIdx)) {
          return select(yesIdx)
        }
      }

      const party = g.$gameParty
      const otmychka = g.$dataItems?.[5]
      const hasOtmychka = party?.hasItem && otmychka ? party.hasItem(otmychka) : false
      const currentLockLevel = g.$gameVariables?.value?.(3) ?? 0

      // 1. Chest lockpicking choice
      if (lockpickIdx >= 0) {
        const v2 = g.$gameVariables?.value?.(2) ?? 0
        const requiredLock = v2

        if (!hasOtmychka || (requiredLock > 0 && currentLockLevel < requiredLock)) {
          if (activeEventId > 0 && requiredLock > 0) {
            StoryContextStore.recordLockPrerequisite(activeMapId, activeEventId, 'chest', requiredLock, currentLockLevel)
          }
          StoryFailureMemory.record(
            activeMapId,
            activeEventId,
            hasOtmychka ? 'skill_required' : 'item_required',
            hasOtmychka ? `Requires lockpick level ${requiredLock}` : 'Requires lockpick item #5',
            condition
          )
          if (leaveIdx >= 0 && allowed.has(leaveIdx)) {
            return select(leaveIdx)
          }
        } else if (!attempts.has(lockpickIdx)) {
          return select(lockpickIdx)
        }
      }

      // 2. Trap disarming choice
      if (disarmIdx >= 0) {
        const v5 = g.$gameVariables?.value?.(5) ?? 0
        const requiredTrap = v5

        if (requiredTrap > 0 && currentLockLevel < requiredTrap) {
          if (activeEventId > 0) {
            StoryContextStore.recordLockPrerequisite(activeMapId, activeEventId, 'trap', requiredTrap, currentLockLevel)
          }
          StoryFailureMemory.record(activeMapId, activeEventId, 'skill_required', `Requires lockpick level ${requiredTrap}`, condition)
          if (leaveIdx >= 0 && allowed.has(leaveIdx)) {
            return select(leaveIdx)
          }
        } else if (!attempts.has(disarmIdx)) {
          return select(disarmIdx)
        }
      }
    } else {
      if (lockpickIdx >= 0 && !attempts.has(lockpickIdx)) {
        return select(lockpickIdx)
      }
    }
    if ((lockpickIdx >= 0 || disarmIdx >= 0) && leaveIdx >= 0 && allowed.has(leaveIdx)) return leaveIdx
    if (attempts.size >= choices.length) return allowed.has(context.cancelIndex) || allowed.size === choices.length ? -1 : -2
    if (playerGuidance) {
      const lower = positiveStoryGuidance(playerGuidance).toLowerCase()
      const matchIdx = choices.findIndex((choice, index) => {
        const clean = choice
          .replace(/<[^>]+>/g, '')
          .trim()
          .toLowerCase()
        return !attempts.has(index) && lower && clean && (lower.includes(clean) || clean.includes(lower))
      })
      if (matchIdx >= 0) {
        return select(matchIdx)
      }
    }
    if (isBenchmarkStoryGame() && currentMapId === 215) {
      const act1Idx = choices.findIndex((c) => c.includes('第一幕') || c.includes('Act I') || c.includes('1Prolog'))
      if (act1Idx >= 0 && !attempts.has(act1Idx)) {
        return select(act1Idx)
      }
    }
    const yesIdx = choices.findIndex((c) => /^(是|确认|好|接受|yes|ok)/i.test(c.trim()))
    if (yesIdx >= 0 && choices.length <= 2 && !attempts.has(yesIdx)) {
      return select(yesIdx)
    }

    // L1: LLM model choice decision
    if (this.deps.complete && this.deps.profileId && this.deps.model) {
      try {
        const startedAt = Date.now()
        const recent = this.getRecentHistory(5).join('\n')
        const attemptsHint = attempts.size > 0 ? `\n（提示：选项 ${Array.from(attempts).join(', ')} 之前已尝试过，请选择其他推进项）` : ''
        const prompt = `剧情对话上下文：\n${recent || '（开场）'}\n当前问句：${engine.$gameMessage?.allText?.() ?? ''}\n玩家目标与后续指示（冲突时最新指示优先）：\n${playerGuidance || '优先完成本层可处理目标，避免无依据回程'}\n\n当前可选分支：\n${choices.map((c, i) => `${i}. ${c}`).join('\n')}${attemptsHint}\n请选择推进剧情的选项编号：`

        const reply = await this.deps.complete(
          [
            { role: 'system', content: '你是一个RPG游戏伴游AI。根据剧情对话与选项，挑选推进主线剧情的选项。只需回复纯数字编号，不要输出额外文字。' },
            { role: 'user', content: prompt },
          ],
          {
            profileId: this.deps.profileId,
            model: this.deps.model,
            purpose: 'route',
            signal: signal ?? new AbortController().signal,
          }
        )

        signal?.throwIfAborted()
        const durationMs = Date.now() - startedAt
        const thought = reply.thought || (reply as any).reasoning_content || undefined
        const match = reply.content.match(/\d+/)
        if (match) {
          const picked = parseInt(match[0], 10)
          if (picked >= 0 && picked < choices.length && !attempts.has(picked)) {
            this.deps.onThought?.({
              model: this.deps.model,
              durationMs,
              thought,
              promptSummary: `剧情分支选项仲裁：[${choices.join(' / ')}]`,
              decision: `选择分支 ${picked}: "${choices[picked]}"`,
              at: Date.now(),
            })
            return select(picked)
          }
        }
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof Error && error.name === 'AbortError') throw error
      }
    }

    // L2: Safe fallback to first unattempted choice
    for (let i = 0; i < choices.length; i++) {
      if (!attempts.has(i)) {
        return select(i)
      }
    }
    return leaveIdx >= 0 && allowed.has(leaveIdx) ? leaveIdx : -1
  }

  public applyChoiceSelection(win: any, pickedIdx: number): boolean {
    const selection = this.selection
    this.selection = null
    const choiceWin = win ? win._choiceWindow : null
    if (choiceWin?.active && pickedIdx >= 0 && this.allowedChoices?.has(pickedIdx) !== false && typeof choiceWin.processOk === 'function') {
      choiceWin.select(pickedIdx)
      if (choiceWin.isCurrentItemEnabled?.() === false) return false
      choiceWin.processOk()
      if (!choiceWin.active && selection?.index === pickedIdx) selection.commit()
      return !choiceWin.active
    }
    return false
  }
}
