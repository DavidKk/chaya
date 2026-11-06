import type { CompanionComplete } from '../companion-chat'

export type PuzzleContext = {
  mapId: number
  mapName?: string
  playerPos: { x: number; y: number }
  recentDialogue: string[]
  inventorySummary: string[]
  visibleEvents: Array<{ id: number; name: string; x: number; y: number; kind?: string }>
  unreachableTarget?: { id: number; name: string; x: number; y: number }
}

export type PuzzleDiagnosis = {
  targetEventId?: number
  targetPos?: { x: number; y: number }
  reason: string
  suggestedAction: string
  hint: string
}

export type PuzzleSolverDeps = {
  complete?: CompanionComplete
  profileId?: string
  model?: string
  signal?: AbortSignal
}

export class StoryPuzzleSolver {
  constructor(private readonly deps: PuzzleSolverDeps = {}) {}

  public async diagnoseNextStep(ctx: PuzzleContext): Promise<PuzzleDiagnosis> {
    // 1. Try remote model reasoning if configured
    if (this.deps.complete && this.deps.profileId && this.deps.model) {
      try {
        const diagnosis = await this.askModel(ctx)
        if (diagnosis) return diagnosis
      } catch {
        // Fall through to heuristic
      }
    }

    // 2. Local heuristic fallback
    return this.heuristicFallback(ctx)
  }

  private async askModel(ctx: PuzzleContext): Promise<PuzzleDiagnosis | null> {
    const prompt = `当前地图：${ctx.mapName || '未知区域'} (ID: ${ctx.mapId})，坐标 (${ctx.playerPos.x}, ${ctx.playerPos.y})
近期对话要点：
${ctx.recentDialogue.slice(-5).join('\n') || '（无近期台词）'}

背包关键道具：${ctx.inventorySummary.join('、') || '（无关键道具）'}

地图可见事件：
${ctx.visibleEvents.map((e) => `- ID ${e.id}: "${e.name}" at (${e.x}, ${e.y})`).join('\n')}
${ctx.unreachableTarget ? `当前阻碍/无法抵达的目标：ID ${ctx.unreachableTarget.id} "${ctx.unreachableTarget.name}" at (${ctx.unreachableTarget.x}, ${ctx.unreachableTarget.y})` : ''}

请分析下一步应该前往调查或互动的目标，输出 JSON：
{"targetEventId": 目标事件ID数字或null, "reason": "分析原因", "hint": "简短伴游提示"}
`

    const reply = await this.deps.complete!(
      [
        {
          role: 'system',
          content:
            '你是一个RPG游戏伴游解谜专家。根据剧情上下文与地图事件，分析脱困推进的目标。只返回纯 JSON，不要输出额外解释或 markdown 标记。',
        },
        { role: 'user', content: prompt },
      ],
      {
        profileId: this.deps.profileId!,
        model: this.deps.model!,
        purpose: 'route',
        signal: this.deps.signal,
      }
    )

    try {
      const raw = reply.content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
      const data = JSON.parse(raw)
      const targetEventId = typeof data.targetEventId === 'number' ? data.targetEventId : undefined
      const targetEvent = targetEventId ? ctx.visibleEvents.find((e) => e.id === targetEventId) : undefined

      return {
        targetEventId,
        targetPos: targetEvent ? { x: targetEvent.x, y: targetEvent.y } : undefined,
        reason: data.reason || '模型推荐目标',
        suggestedAction: 'interact',
        hint: data.hint || (targetEvent ? `调查 ${targetEvent.name}` : '寻找周围机关线索'),
      }
    } catch {
      return null
    }
  }

  private heuristicFallback(ctx: PuzzleContext): PuzzleDiagnosis {
    // Priority 1: Check for any lever, switch, or button events
    const lever = ctx.visibleEvents.find((e) => /(рычаг|lever|switch|кнопка|机关|开关)/i.test(e.name))
    if (lever) {
      return {
        targetEventId: lever.id,
        targetPos: { x: lever.x, y: lever.y },
        reason: '优先触发未交互的机关拉杆',
        suggestedAction: 'interact',
        hint: `尝试拉动机关 ${lever.name} (${lever.x}, ${lever.y})`,
      }
    }

    // Priority 2: Check for nearest NPC to ask for directions/clues
    const npc = ctx.visibleEvents.find((e) => e.kind === 'npc' || /(магистр|старейшина|npc|elder|guide)/i.test(e.name))
    if (npc) {
      return {
        targetEventId: npc.id,
        targetPos: { x: npc.x, y: npc.y },
        reason: '与附近 NPC 交谈获取最新进展线索',
        suggestedAction: 'interact',
        hint: `与 ${npc.name} 对话获取线索`,
      }
    }

    // Priority 3: Check for portals/doors
    const portal = ctx.visibleEvents.find((e) => e.kind === 'transfer' || /(door|дверь|portal|stairs|выход|门)/i.test(e.name))
    if (portal) {
      return {
        targetEventId: portal.id,
        targetPos: { x: portal.x, y: portal.y },
        reason: '尝试调查通道门扉',
        suggestedAction: 'interact',
        hint: `前往通道门 ${portal.name}`,
      }
    }

    return {
      reason: '未发现明显可疑机关，建议巡查周围网格',
      suggestedAction: 'explore',
      hint: '在当前房间周围四处调查看看',
    }
  }
}
