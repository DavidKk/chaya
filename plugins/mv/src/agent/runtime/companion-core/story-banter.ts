import type { CompanionComplete } from '../companion-chat'

export type BanterEventType =
  | 'loot'
  | 'battle_start'
  | 'battle_win'
  | 'danger'
  | 'puzzle'
  | 'map_transition'
  | 'idle'
  | 'milestone'

export type BanterPayload = {
  name?: string
  detail?: string
  mapId?: number
  gold?: number
}

export type BanterEngineDeps = {
  complete?: CompanionComplete
  profileId?: string
  model?: string
  character?: string
  locale?: string
  onBanter?: (line: string) => void
  signal?: AbortSignal
}

const DEFAULT_LINES: Record<string, Record<BanterEventType, string[]>> = {
  zh: {
    loot: [
      '找到了好东西，这下背包更充实了！',
      '这角落果然藏着宝箱，收获不错。',
      '搜刮完毕，每一枚金币都不能落下！',
      '战利品到手，看来细心搜查是值得的。',
    ],
    battle_start: [
      '有敌人伏击！别慌，交给我速战速决！',
      '准备迎战，让我们把它们一网打尽！',
      '怪物靠近了，拔剑吧！',
    ],
    battle_win: [
      '搞定！就这几个小怪，根本拦不住我们。',
      '战斗胜利！配合得越来越默契了。',
      '轻松搞定，保持这个状态继续前进！',
    ],
    danger: [
      '刚才那下有点险，先把血量拉起来！',
      '小心点，大家状态不太好，先稳一稳！',
    ],
    puzzle: [
      '听到咔哒一声，机关应该已经触发了！',
      '暗门解锁了，走，去前面看看！',
      '机关解开了，这谜题看来难不倒我们。',
    ],
    map_transition: [
      '进入新区域了，周围光线有些暗，小心脚下。',
      '这里看起来更深入了，集中精神继续探索。',
      '到达新场景，看看这里有什么新线索。',
    ],
    idle: [
      '这一路上还挺刺激的，你累了吗？',
      '四处看看，别漏掉任何隐蔽的暗道。',
      '慢慢来，我们一定会把这个迷宫走穿的。',
    ],
    milestone: [
      '太棒了！这一阶段的重大目标顺利达成了！',
      '干得漂亮！序章试炼终于被我们突破了！',
    ],
  },
}

export class CompanionBanterEngine {
  private lastBanterAt = 0
  private readonly minIntervalMs = 8_000
  private readonly lastKindAt = new Map<BanterEventType, number>()
  private isGenerating = false

  constructor(private readonly deps: BanterEngineDeps = {}) {}

  public trigger(type: BanterEventType, payload?: BanterPayload): void {
    const now = Date.now()

    // Milestone bypasses cooldown; other events respect minIntervalMs
    if (type !== 'milestone') {
      if (now - this.lastBanterAt < this.minIntervalMs) return
      const lastType = this.lastKindAt.get(type) || 0
      if (now - lastType < 15_000) return
    }

    this.lastBanterAt = now
    this.lastKindAt.set(type, now)

    // 1. Pick a natural preset line
    const line = this.pickPresetLine(type, payload)
    if (line) {
      this.broadcast(line)
    }

    // 2. Optionally trigger async remote LLM flavor for major events if model is active
    if (type === 'milestone' && this.deps.complete && this.deps.profileId && this.deps.model && !this.isGenerating) {
      this.generateAsyncBanter(type, payload)
    }
  }

  private pickPresetLine(type: BanterEventType, payload?: BanterPayload): string {
    const lang = (this.deps.locale || 'zh').slice(0, 2)
    const pool = DEFAULT_LINES[lang]?.[type] || DEFAULT_LINES.zh[type] || []
    if (pool.length === 0) return ''

    const base = pool[Math.floor(Math.random() * pool.length)]
    if (payload?.name && type === 'loot') {
      return `获得了【${payload.name}】！${base}`
    }
    return base
  }

  private broadcast(line: string): void {
    this.deps.onBanter?.(line)

    // Dispatch DOM event for companion panel transcript
    if (typeof window !== 'undefined') {
      try {
        const event = {
          kind: 'cue',
          messageId: `banter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          text: line,
          seq: Date.now(),
          at: Date.now(),
          character: this.deps.character || 'rin',
        }
        window.dispatchEvent(new CustomEvent('chaya:companion-message', { detail: event }))
      } catch {
        // Non-browser or isolated environment
      }
    }
  }

  private async generateAsyncBanter(type: BanterEventType, payload?: BanterPayload): Promise<void> {
    if (!this.deps.complete || !this.deps.profileId || !this.deps.model) return
    this.isGenerating = true

    try {
      const prompt = `你是一个RPG游戏中的亲密冒险旅伴，性格活泼机智。当前事件：${type}，详情：${JSON.stringify(payload || {})}。请用一句话说出你的感叹或吐槽，自然生动，不超过25字。`
      const reply = await this.deps.complete(
        [
          { role: 'system', content: '你是游戏伴游AI。用简短自然的口语对游戏进展发出感叹。直接输出台词，不要带引号或前缀。' },
          { role: 'user', content: prompt },
        ],
        {
          profileId: this.deps.profileId,
          model: this.deps.model,
          purpose: 'chat',
          signal: this.deps.signal ?? new AbortController().signal,
        }
      )
      const clean = reply.content.replace(/^["'“‘]|["'”’]$/g, '').trim()
      if (clean && clean.length <= 40) {
        this.broadcast(clean)
      }
    } catch {
      // Fallback silently if async call fails
    } finally {
      this.isGenerating = false
    }
  }
}
