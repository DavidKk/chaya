import type { ExplorationTarget } from './story-exploration'

export type StoryRouteStep = {
  target: ExplorationTarget
  requiredLevel: number
  expectedLevel: number
  expectedBenefit: string
}

export type StoryRoutePlan = {
  goalEventId: number
  requiredLevel: number
  steps: StoryRouteStep[]
  cost: number
  complete: boolean
  exitCondition: string
}

export type StoryTrainingTarget = {
  target: ExplorationTarget
  requiredLevel: number
  expectedGain: number
}

export function storyExpectedLockGain(event: any): number {
  const engine = globalThis as any
  const seen = new Set<number>()
  const scan = (list: any[], depth = 0): number => {
    if (depth > 20) return 0
    let gain = 0
    for (const command of list) {
      const parameters = command?.parameters ?? []
      if (command?.code === 122 && parameters[0] <= 3 && parameters[1] >= 3 && parameters[2] === 1 && parameters[3] === 0 && parameters[4] > 0) {
        gain = Math.max(gain, parameters[4])
      }
      if (command?.code === 117 && !seen.has(parameters[0])) {
        seen.add(parameters[0])
        gain = Math.max(gain, scan(engine.$dataCommonEvents?.[parameters[0]]?.list ?? [], depth + 1))
      }
    }
    return gain
  }
  return scan(event?.list?.() ?? [])
}

export function buildStoryRoutes(
  training: StoryTrainingTarget[],
  goals: Array<{ target: ExplorationTarget; requiredLevel: number }>,
  level: number,
  position: { x: number; y: number }
): StoryRoutePlan[] {
  const plans: StoryRoutePlan[] = []
  const distance = (left: { x: number; y: number }, right: { x: number; y: number }) => Math.abs(left.x - right.x) + Math.abs(left.y - right.y)
  for (const goal of goals) {
    if (goal.requiredLevel <= level) continue
    const starts = training.filter((entry) => entry.requiredLevel <= level && entry.expectedGain > 0 && entry.target.eventId !== goal.target.eventId)
    for (const start of starts) {
      const steps: StoryRouteStep[] = []
      const used = new Set<number>()
      let projected = level
      let cost = 0
      let cursor = position
      let next: StoryTrainingTarget | undefined = start
      while (next && steps.length < 16 && projected < goal.requiredLevel) {
        used.add(next.target.eventId)
        projected += next.expectedGain
        cost += distance(cursor, next.target) + 4
        steps.push({
          target: next.target,
          requiredLevel: next.requiredLevel,
          expectedLevel: projected,
          expectedBenefit: `成功后预计开锁等级达到 ${projected}；未获得提升则废弃路线并重新规划`,
        })
        cursor = next.target
        next = training
          .filter((entry) => !used.has(entry.target.eventId) && entry.target.eventId !== goal.target.eventId && entry.requiredLevel <= projected && entry.expectedGain > 0)
          .sort((left, right) => distance(cursor, left.target) - distance(cursor, right.target))[0]
      }
      const complete = projected >= goal.requiredLevel
      if (complete) {
        cost += distance(cursor, goal.target) + 4
        steps.push({
          target: goal.target,
          requiredLevel: goal.requiredLevel,
          expectedLevel: projected,
          expectedBenefit: `技能达标后返回目标 #${goal.target.eventId}；仍须验证实际交互成功`,
        })
      }
      plans.push({
        goalEventId: goal.target.eventId,
        requiredLevel: goal.requiredLevel,
        steps,
        cost,
        complete,
        exitCondition: complete ? '每步确认收益，失败立即改道；最终确认目标事件完成' : `当前路线经验不足，完成可用步骤后寻找其他事件，禁止重复失败目标 #${goal.target.eventId}`,
      })
    }
  }
  return plans.sort((left, right) => Number(right.complete) - Number(left.complete) || left.cost - right.cost).slice(0, 4)
}
