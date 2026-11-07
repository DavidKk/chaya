import { applyControlTurnEvent } from '@/components/game-agent/companion-control-events'
import type { TurnEvent } from '@/components/game-agent/turnStream'

describe('applyControlTurnEvent with model.thought', () => {
  it('records latest thought and creates a collapsible thought message line', () => {
    const item: TurnEvent = {
      type: 'model.thought',
      model: 'qwen3:4b',
      durationMs: 1200,
      thought: '正在分析盗贼地下室的脱困路线，检测到机关拉杆未拉动...',
      promptSummary: '地图 5 遇到解谜阻碍，分析下一步交互目标',
      decision: '前往 Lever Switch (2, 3) - 优先触发未交互的机关拉杆',
    }

    const result = applyControlTurnEvent({
      taskId: 'task-1',
      item,
      character: 'rin',
      messages: [],
    })

    expect(result.latestThought).toEqual(
      expect.objectContaining({
        model: 'qwen3:4b',
        durationMs: 1200,
        thought: '正在分析盗贼地下室的脱困路线，检测到机关拉杆未拉动...',
        promptSummary: '地图 5 遇到解谜阻碍，分析下一步交互目标',
        decision: '前往 Lever Switch (2, 3) - 优先触发未交互的机关拉杆',
      })
    )
    expect(result.messages).toHaveLength(1)
    expect(result.messages![0].thought).toEqual(result.latestThought)
  })
})
