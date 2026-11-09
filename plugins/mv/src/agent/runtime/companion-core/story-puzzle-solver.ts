import type { CompanionComplete } from '../companion-chat'
import { StoryContextStore } from './story-context'
import { positiveStoryGuidance } from './story-guidance'

export type PuzzleContext = {
  mapId: number
  mapName?: string
  playerPos: { x: number; y: number }
  recentDialogue: string[]
  inventorySummary: string[]
  visibleEvents: Array<{ id: number; name: string; x: number; y: number; kind?: string; reachable?: boolean; preview?: string }>
  unreachableTarget?: { id: number; name: string; x: number; y: number }
  playerGuidance?: string | null
  questContextSummary?: string
}

export type PuzzleDiagnosis = {
  targetEventId?: number
  targetPos?: { x: number; y: number }
  reason: string
  suggestedAction: string
  hint: string
}

export type ModelThoughtEvent = {
  id?: string
  model: string
  durationMs: number
  thought?: string
  promptSummary?: string
  decision?: string
  at?: number
}

export type PuzzleSolverDeps = {
  complete?: CompanionComplete
  profileId?: string
  model?: string
  signal?: AbortSignal
  onThought?: (thought: ModelThoughtEvent) => void
  onDiagnosing?: () => void
}

export class StoryPuzzleSolver {
  constructor(private readonly deps: PuzzleSolverDeps = {}) {}

  public async diagnoseNextStep(ctx: PuzzleContext, signal = this.deps.signal): Promise<PuzzleDiagnosis> {
    signal?.throwIfAborted()

    // 1. Fast-Path: High-confidence heuristic clue matching
    // If recent dialogue or guidance directly points to an identifiable target on the map (e.g. Severin's shop, lever, door),
    // resolve immediately with zero latency and 100% determinism.
    const directMatch = this.matchDirectClue(ctx)
    if (directMatch) {
      return directMatch
    }

    // 2. Focused model reasoning with pre-ranked Top-K candidates
    if (this.deps.complete && this.deps.profileId && this.deps.model) {
      this.deps.onDiagnosing?.()
      try {
        const diagnosis = await this.askModel(ctx, signal)
        signal?.throwIfAborted()
        if (diagnosis) return diagnosis
      } catch (err) {
        signal?.throwIfAborted()
        console.warn('[StoryPuzzleSolver] Model reasoning failed:', err)
        // Fall through to heuristic
      }
    }

    // 3. Local heuristic fallback
    return this.heuristicFallback(ctx)
  }

  public matchDirectClue(ctx: PuzzleContext): PuzzleDiagnosis | null {
    // Priority 0: Player explicit guidance has top priority
    if (ctx.playerGuidance) {
      const lower = positiveStoryGuidance(ctx.playerGuidance).toLowerCase()
      const match = ctx.visibleEvents.find((e) => (e.name && lower.includes(e.name.toLowerCase())) || (e.kind && lower.includes(e.kind)))
      if (match) {
        return {
          targetEventId: match.id,
          targetPos: { x: match.x, y: match.y },
          reason: '遵循玩家建议目标',
          suggestedAction: 'interact',
          hint: `根据建议调查 ${match.name} (${match.x}, ${match.y})`,
        }
      }
    }

    // Priority 0b: Dialogue clue matching (e.g. Severin's shop or specific place mentioned in recent dialogue)
    const dialogueText = ctx.recentDialogue.slice(-5).join(' ')
    if (!dialogueText) return null

    // Check specific name mentions (e.g. Severin / 塞维林 / Северин)
    if (/(塞维林|severin|северин)/i.test(dialogueText)) {
      const severinMatch = ctx.visibleEvents.find(
        (e) =>
          /(северин|severin|塞维林)/i.test(e.name) ||
          /(северин|severin|塞维林)/i.test(e.preview || '') ||
          (e.kind === 'shop' && /(северин|severin|лавка|магазин|shop|塞维林)/i.test(e.name + (e.preview || '')))
      )
      if (severinMatch) {
        return {
          targetEventId: severinMatch.id,
          targetPos: { x: severinMatch.x, y: severinMatch.y },
          reason: '剧情对话线索指引：前往塞维林的店铺',
          suggestedAction: 'interact',
          hint: `前往塞维林的店铺 ${severinMatch.name} (${severinMatch.x}, ${severinMatch.y})`,
        }
      }
    }

    // Check shop / store mentions
    if (/(店|商店|лавка|магазин|shop)/i.test(dialogueText)) {
      const shopMatch = ctx.visibleEvents.find((e) => e.kind === 'shop' || /(магазин|лавка|shop|商店|店)/i.test(e.name) || /(магазин|лавка|shop|商店|店)/i.test(e.preview || ''))
      if (shopMatch) {
        return {
          targetEventId: shopMatch.id,
          targetPos: { x: shopMatch.x, y: shopMatch.y },
          reason: '剧情对话线索指引：前往商店设施',
          suggestedAction: 'interact',
          hint: `前往商店 ${shopMatch.name} (${shopMatch.x}, ${shopMatch.y})`,
        }
      }
    }

    return null
  }

  private async askModel(ctx: PuzzleContext, signal?: AbortSignal): Promise<PuzzleDiagnosis | null> {
    const questSection = ctx.questContextSummary ? `${ctx.questContextSummary}\n\n` : ''

    // Pre-rank candidates to keep the prompt focused on the most relevant events (Top 8 max)
    const dialogueLower = ctx.recentDialogue.join(' ').toLowerCase()
    const scored = ctx.visibleEvents.map((e) => {
      let score = 0
      const nameLower = (e.name || '').toLowerCase()
      const previewLower = (e.preview || '').toLowerCase()

      if (dialogueLower) {
        for (const token of ['северин', 'severin', '塞维林', 'лавка', 'магазин', 'shop', 'рычаг', 'lever', 'кнопка', 'ключ', 'key', 'дверь', 'door']) {
          if (dialogueLower.includes(token)) {
            if (nameLower.includes(token) || previewLower.includes(token)) score += 50
          }
        }
      }

      if (e.kind === 'lever') score += 20
      if (e.kind === 'shop') score += 15
      if (e.kind === 'npc') score += 10
      if (e.reachable !== false) score += 5

      const dist = Math.abs(e.x - ctx.playerPos.x) + Math.abs(e.y - ctx.playerPos.y)
      score -= Math.min(20, Math.floor(dist / 5))

      return { event: e, score }
    })

    scored.sort((a, b) => b.score - a.score)
    const candidates = scored.slice(0, 8).map((s) => s.event)

    const prompt = `当前地图：${ctx.mapName || '未知区域'} (ID: ${ctx.mapId})，坐标 (${ctx.playerPos.x}, ${ctx.playerPos.y})
近期剧情/对话要点（注意：游戏剧情可能有俄语/英语原名与中文翻译对应，如“塞维林”对应俄语“Северин”/Severin，“店/商店”对应“Лавка”/“Магазин”/Shop）：
${ctx.recentDialogue.slice(-8).join('\n') || '（无近期台词）'}

背包关键道具：${ctx.inventorySummary.join('、') || '（无关键道具）'}

地图候选事件列表（已根据线索相关度预先筛选）：
${candidates.map((e) => `- ID ${e.id}: "${e.name}" at (${e.x}, ${e.y}) [类型: ${e.kind || '未知'}, 可达: ${e.reachable !== false ? '是' : '否'}${e.preview ? `, 内容预览: "${e.preview}"` : ''}]`).join('\n')}
${questSection}
${
  ctx.unreachableTarget
    ? `当前阻碍/无法抵达的目标：ID ${ctx.unreachableTarget.id} "${ctx.unreachableTarget.name}" at (${ctx.unreachableTarget.x}, ${ctx.unreachableTarget.y})
`
    : ''
}${
      ctx.playerGuidance
        ? `玩家目标与后续指示（按时间顺序，冲突时最新指示优先，禁止违反路线限制）：
${ctx.playerGuidance}
`
        : ''
    }
任务说明：
请仔细结合近期对话中的线索提示（例如去某个特定的店铺、找某个人、使用某个机关等）。如果对话指明了要去的地方或找的人，请在事件列表中寻找对应的目标（注意俄文/英文名称与中文译名的对应关系，如 Северин/Severin/Лавка/Shop 等）。
优先选择最符合剧情线索的目标。只能选择以上候选事件 ID，无可行目标时返回 null。
请输出 JSON：
{"targetEventId": 目标事件ID数字或null, "reason": "分析原因", "hint": "简短伴游提示"}
`

    const startedAt = Date.now()
    const promptSummary = `地图 ${ctx.mapId} (${ctx.mapName || '未知'}) 遇到脱困或解谜阻碍，分析下一步交互目标`

    const reply = await this.deps.complete!(
      [
        {
          role: 'system',
          content: '你是一个RPG游戏伴游解谜专家。根据剧情上下文与地图事件，分析脱困推进的目标。只返回纯 JSON，不要输出额外解释或 markdown 标记。',
        },
        { role: 'user', content: prompt },
      ],
      {
        profileId: this.deps.profileId!,
        model: this.deps.model!,
        purpose: 'route',
        think: true,
        signal: signal ?? new AbortController().signal,
      }
    )
    signal?.throwIfAborted()

    const durationMs = Date.now() - startedAt
    const thought = reply.thought || (reply as any).reasoning_content || undefined

    try {
      const match = reply.content.match(/\{[\s\S]*\}/)
      const raw = match
        ? match[0]
        : reply.content
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
      const data = JSON.parse(raw)
      const targetEventId = typeof data.targetEventId === 'number' ? data.targetEventId : undefined
      const targetEvent = targetEventId ? ctx.visibleEvents.find((e) => e.id === targetEventId) : undefined

      const diagnosis: PuzzleDiagnosis = {
        targetEventId,
        targetPos: targetEvent ? { x: targetEvent.x, y: targetEvent.y } : undefined,
        reason: data.reason || '模型推荐目标',
        suggestedAction: 'interact',
        hint: data.hint || (targetEvent ? `调查 ${targetEvent.name}` : '寻找周围机关线索'),
      }
      this.deps.onThought?.({
        model: this.deps.model!,
        durationMs,
        thought,
        promptSummary,
        decision: targetEvent ? `前往 ${targetEvent.name} (${targetEvent.x}, ${targetEvent.y}) - ${diagnosis.reason}` : diagnosis.reason,
        at: Date.now(),
      })
      return diagnosis
    } catch {
      this.deps.onThought?.({
        model: this.deps.model!,
        durationMs,
        thought,
        promptSummary,
        decision: reply.content.trim().slice(0, 100) || '无法解析模型结构化决策',
        at: Date.now(),
      })
      return null
    }
  }

  private heuristicFallback(ctx: PuzzleContext): PuzzleDiagnosis {
    // Priority 0: Player explicit guidance
    if (ctx.playerGuidance) {
      const lower = positiveStoryGuidance(ctx.playerGuidance).toLowerCase()
      const match = ctx.visibleEvents.find((e) => (e.name && lower.includes(e.name.toLowerCase())) || (e.kind && lower.includes(e.kind)))
      if (match) {
        return {
          targetEventId: match.id,
          targetPos: { x: match.x, y: match.y },
          reason: '遵循玩家建议目标',
          suggestedAction: 'interact',
          hint: `根据建议调查 ${match.name} (${match.x}, ${match.y})`,
        }
      }
    }

    // Priority 0b: Dialogue clue matching (e.g. Severin's shop or specific place mentioned in recent dialogue)
    const dialogueText = ctx.recentDialogue.join(' ')
    if (/(塞维林|severin|северин)/i.test(dialogueText)) {
      const severinMatch = ctx.visibleEvents.find(
        (e) =>
          /(северин|severin|塞维林)/i.test(e.name) ||
          /(северин|severin|塞维林)/i.test(e.preview || '') ||
          (e.kind === 'shop' && /(северин|severin|лавка|магазин|shop|塞维林)/i.test(e.name + (e.preview || '')))
      )
      if (severinMatch) {
        return {
          targetEventId: severinMatch.id,
          targetPos: { x: severinMatch.x, y: severinMatch.y },
          reason: '剧情对话提示需要前往塞维林的店铺',
          suggestedAction: 'interact',
          hint: `前往塞维林的店铺 ${severinMatch.name} (${severinMatch.x}, ${severinMatch.y})`,
        }
      }
    }
    if (/(店|商店|лавка|магазин|shop)/i.test(dialogueText)) {
      const shopMatch = ctx.visibleEvents.find((e) => e.kind === 'shop' || /(магазин|лавка|shop|商店|店)/i.test(e.name) || /(магазин|лавка|shop|商店|店)/i.test(e.preview || ''))
      if (shopMatch) {
        return {
          targetEventId: shopMatch.id,
          targetPos: { x: shopMatch.x, y: shopMatch.y },
          reason: '剧情对话提示需要前往商店设施',
          suggestedAction: 'interact',
          hint: `前往商店 ${shopMatch.name} (${shopMatch.x}, ${shopMatch.y})`,
        }
      }
    }

    // Priority 1: Check for any lever, switch, or button events
    const lever = ctx.visibleEvents.find((e) => e.kind === 'lever' || /(рычаг|lever|switch|кнопка|机关|开关)/i.test(e.name))
    if (lever) {
      return {
        targetEventId: lever.id,
        targetPos: { x: lever.x, y: lever.y },
        reason: '优先触发未交互的机关拉杆',
        suggestedAction: 'interact',
        hint: `尝试拉动机关 ${lever.name} (${lever.x}, ${lever.y})`,
      }
    }

    // Priority 2: Check for uncollected chests or loot in current chamber
    const chest = ctx.visibleEvents.find((e) => e.kind === 'chest' || /(сундук|chest|宝箱|箱)/i.test(e.name))
    if (chest) {
      return {
        targetEventId: chest.id,
        targetPos: { x: chest.x, y: chest.y },
        reason: '调查尚未开启的宝箱',
        suggestedAction: 'interact',
        hint: `开启宝箱 ${chest.name}`,
      }
    }

    // Priority 3: Check for NPC to ask for directions/clues
    const npc = ctx.visibleEvents.find((e) => e.kind === 'npc' || /(магистр|старейшина|npc|elder|guide|会长|人)/i.test(e.name))
    if (npc) {
      return {
        targetEventId: npc.id,
        targetPos: { x: npc.x, y: npc.y },
        reason: '与附近 NPC 交谈获取最新进展线索',
        suggestedAction: 'interact',
        hint: `与 ${npc.name} 对话获取线索`,
      }
    }

    // Priority 4: Forward portal / door (skipping entry/backtrack portal)
    const portal = ctx.visibleEvents.find((e) => {
      const isPortal = e.kind === 'transfer' || /(door|дверь|portal|stairs|выход|门|梯)/i.test(e.name)
      if (!isPortal) return false
      return !StoryContextStore.isBacktrackPortal(ctx.mapId, e.id)
    })
    if (portal) {
      return {
        targetEventId: portal.id,
        targetPos: { x: portal.x, y: portal.y },
        reason: '当前房间交互已探明，前往通道门扉探索新区域',
        suggestedAction: 'interact',
        hint: `前往通道门 ${portal.name}`,
      }
    }

    // Priority 4: Nearest visible interactive event
    if (ctx.visibleEvents.length > 0) {
      const first = ctx.visibleEvents[0]
      return {
        targetEventId: first.id,
        targetPos: { x: first.x, y: first.y },
        reason: '巡回调查当前区域未完全探明的事件',
        suggestedAction: 'interact',
        hint: `调查 ${first.name} (${first.x}, ${first.y})`,
      }
    }

    return {
      reason: '未发现明显可疑机关，建议巡查周围网格',
      suggestedAction: 'explore',
      hint: '在当前房间周围四处调查看看',
    }
  }
}
