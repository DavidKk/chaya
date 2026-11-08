import type { ExplorationTarget } from './story-exploration'
import { isCrossMapTransfer, storyTransfers, storyTravelDirection } from './story-transfer'

export type StoryTravelPolicy = {
  forbidUp: boolean
  forbidDown: boolean
  stayOnMap: boolean
  forbidBacktrack: boolean
  explicitTravel: boolean
}

const NEGATIVE = /不要|不能|禁止|不许|不准|别|勿|不再|暂不|先不|不上|不下|不回|don't|do not|never|avoid|не\s/i

export function positiveStoryGuidance(text?: string | null): string {
  return (text ?? '')
    .split(/[，。；！\n,;!]+/)
    .filter((clause) => !NEGATIVE.test(clause))
    .join('，')
}

export function isStoryCustodyRequest(text: string): boolean {
  return /^(开启|开始|启动|帮我|请帮我)?\s*(托管|全托管|全剧情托管|剧情全托管|全托管剧情|托管剧情|剧情托管|自律推进|继续剧情|自动过剧情|自动剧情|过剧情|代打剧情)(\s*(剧情|探索|模式|游玩))?(?:$|[，。；！\n,;!])/.test(
    text.trim()
  )
}

export function storyTravelPolicy(text?: string | null): StoryTravelPolicy {
  const policy: StoryTravelPolicy = { forbidUp: false, forbidDown: false, stayOnMap: false, forbidBacktrack: false, explicitTravel: false }
  for (const clause of (text ?? '').split(/[，。；！\n,;!]+/)) {
    const negative = NEGATIVE.test(clause)
    const up = /上(?:上|一)?(?:层|樓|楼)|往上|upstairs|stairs\s*up|go\s*up|наверх|подняться/i.test(clause)
    const down = /下(?:一)?(?:层|樓|楼)|往下|downstairs|stairs\s*down|go\s*down|вниз|спуститься/i.test(clause)
    const travel = /传送|傳送|切图|换层|离开|離開|出口|楼梯|樓梯|teleport|portal|leave|exit|stairs/i.test(clause)
    const backtrack = /回(?:去|头|退|到|上一)|往回|走回|返(?:回|程)|backtrack|go back|return|назад/i.test(clause)
    const stay = /(?:留在|待在|只(?:在|探索|处理)|仅(?:在|探索|处理)|stay|remain).*(?:本层|这(?:一)?层|当前|本地图|这里|current|this|here)/i.test(clause)
    const localFirst = /(?:先|优先).*(?:本层|这(?:一)?层|当前|本地图|这里)|(?:本层|这(?:一)?层|当前).*(?:清完|处理完|完成)/i.test(clause)
    if (up) policy.forbidUp = negative
    if (down) policy.forbidDown = negative
    if (backtrack) policy.forbidBacktrack = negative
    if (stay || (negative && /离开|離開|切图|换层|传送|傳送|leave|teleport/i.test(clause))) policy.stayOnMap = true
    if (!negative && (up || down || backtrack || travel) && !localFirst && !stay) {
      policy.explicitTravel = true
      policy.stayOnMap = false
    }
    if (negative || localFirst || stay) policy.explicitTravel = false
  }
  return policy
}

export function storyTransferAllowed(policy: StoryTravelPolicy, text: string, backtrack: boolean): boolean {
  if (policy.stayOnMap || (backtrack && (policy.forbidBacktrack || !policy.explicitTravel))) return false
  const direction = storyTravelDirection(text)
  if (policy.forbidUp && direction !== 'down') return false
  if (policy.forbidDown && direction !== 'up') return false
  return true
}

export function storyMapExitAllowed(event: any, mapId: number, policy: StoryTravelPolicy, isBacktrack: (destination: number | null) => boolean): boolean {
  return storyTransfers(event)
    .filter((transfer) => isCrossMapTransfer(transfer, mapId))
    .some((transfer) => {
      const labels = transfer.choices.map((branch) => (branch.index >= 0 ? (branch.labels[branch.index] ?? '') : '')).join(' ')
      return storyTransferAllowed(policy, storyTravelDirection(labels) ? labels : event.event?.()?.name || labels, isBacktrack(transfer.mapId))
    })
}

export function computeGuidanceScore(target: ExplorationTarget, guidance: string, playerPos: { x: number; y: number }): number {
  let score = 0
  const lower = positiveStoryGuidance(guidance).toLowerCase()
  const targetText = `${target.name || ''} ${target.hint || ''} ${target.kind}`.toLowerCase()
  const keywords = [
    '宝箱',
    '箱子',
    'chest',
    'loot',
    '拉杆',
    '机关',
    '开关',
    'lever',
    'switch',
    'npc',
    '对话',
    '会长',
    '长老',
    '老人',
    '门',
    '暗门',
    '出口',
    '楼梯',
    'stairs',
    'door',
    'portal',
  ]
  for (const keyword of keywords) {
    if (lower.includes(keyword) && targetText.includes(keyword)) score += 100
  }
  if ((lower.includes('箱') || lower.includes('宝') || lower.includes('拿') || lower.includes('搜刮')) && target.kind === 'chest') score += 80
  if ((lower.includes('拉杆') || lower.includes('机关') || lower.includes('开关')) && target.kind === 'lever') score += 80
  if ((lower.includes('对话') || lower.includes('问') || lower.includes('找') || lower.includes('人')) && target.kind === 'npc') score += 60
  if ((lower.includes('门') || lower.includes('走') || lower.includes('进') || lower.includes('下')) && target.kind === 'transfer') score += 50
  const deltaX = target.x - playerPos.x
  const deltaY = target.y - playerPos.y
  if ((lower.includes('右') || lower.includes('东')) && deltaX > 0) score += 40
  if ((lower.includes('左') || lower.includes('西')) && deltaX < 0) score += 40
  if ((lower.includes('下') || lower.includes('南')) && deltaY > 0) score += 40
  if ((lower.includes('上') || lower.includes('北')) && deltaY < 0) score += 40
  return score
}
