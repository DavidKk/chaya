import type { CompanionComplete } from '../companion-chat'

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
}

export class StoryDriver {
  private readonly history: DialogueEntry[] = []
  private readonly choiceAttempts = new Map<string, Set<number>>()
  private lastPushedText = ''
  private naturalWaitFrames = 0

  constructor(private readonly deps: StoryDriverDeps = {}) {}

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
    const baseFrames = 8 // ~130ms at 60fps
    const extraFrames = Math.min(24, Math.floor(clean.length / 8))
    return baseFrames + extraFrames
  }

  public tickMessageWindow(win: any): boolean {
    if (!win) return false
    if (typeof win.updateShowFast === 'function') {
      win._showFast = true
    }
    if (win.pause && !win.isAnySubWindowActive()) {
      const text = (globalThis as any).$gameMessage ? (globalThis as any).$gameMessage.allText() : ''
      if (text) this.pushDialogue(text)
      if (this.naturalWaitFrames <= 0) {
        this.naturalWaitFrames = this.computeReadingFrames(text)
      }
      this.naturalWaitFrames--
      if (this.naturalWaitFrames <= 0) {
        win.pause = false
        if (typeof win.terminateMessage === 'function') win.terminateMessage()
        return true
      }
    } else {
      this.naturalWaitFrames = 0
    }
    return false
  }

  public async resolveChoice(choices: string[], currentMapId?: number | null): Promise<number> {
    if (!choices || choices.length === 0) return 0
    const choiceKey = `${currentMapId ?? ''}:${choices.join('|')}`
    const attempts = this.choiceAttempts.get(choiceKey) || new Set<number>()

    // L0: Deterministic rule filter
    if (currentMapId === 215) {
      const act1Idx = choices.findIndex((c) => c.includes('第一幕') || c.includes('Act I') || c.includes('1Prolog'))
      if (act1Idx >= 0) return act1Idx
    }
    const yesIdx = choices.findIndex((c) => /^(是|确认|好|接受|yes|ok)/i.test(c.trim()))
    if (yesIdx >= 0 && choices.length <= 2 && !attempts.has(yesIdx)) {
      attempts.add(yesIdx)
      this.choiceAttempts.set(choiceKey, attempts)
      return yesIdx
    }

    // L1: LLM model choice decision
    if (this.deps.complete && this.deps.profileId && this.deps.model) {
      try {
        const recent = this.getRecentHistory(5).join('\n')
        const prompt = `剧情对话上下文：\n${recent || '（开场）'}\n\n当前可选分支：\n${choices
          .map((c, i) => `${i}. ${c}`)
          .join('\n')}${attempts.size > 0 ? `\n（提示：选项 ${Array.from(attempts).join(', ')} 之前已尝试过，请选择其他推进项）` : ''}\n请选择推进剧情的选项编号：`

        const reply = await this.deps.complete(
          [
            { role: 'system', content: '你是一个RPG游戏伴游AI。根据剧情对话与选项，挑选推进主线剧情的选项。只需回复纯数字编号，不要输出额外文字。' },
            { role: 'user', content: prompt },
          ],
          {
            profileId: this.deps.profileId,
            model: this.deps.model,
            purpose: 'route',
            signal: this.deps.signal,
          }
        )

        const match = reply.content.match(/\d+/)
        if (match) {
          const picked = parseInt(match[0], 10)
          if (picked >= 0 && picked < choices.length && !attempts.has(picked)) {
            attempts.add(picked)
            this.choiceAttempts.set(choiceKey, attempts)
            return picked
          }
        }
      } catch {
        // Fall through to fallback
      }
    }

    // L2: Safe fallback to first unattempted choice
    for (let i = 0; i < choices.length; i++) {
      if (!attempts.has(i)) {
        attempts.add(i)
        this.choiceAttempts.set(choiceKey, attempts)
        return i
      }
    }
    return 0
  }

  public applyChoiceSelection(win: any, pickedIdx: number): void {
    const choiceWin = win ? win._choiceWindow : null
    if (choiceWin) {
      choiceWin.select(pickedIdx)
      if (typeof choiceWin.callOkHandler === 'function') choiceWin.callOkHandler()
      if (typeof choiceWin.deactivate === 'function') choiceWin.deactivate()
      if (typeof choiceWin.close === 'function') choiceWin.close()
    }
  }
}
