'use client'

import { MiniPanelAlert } from '@/components/game-tools/MiniPanelParts'
import type { CompanionHostStatus } from '@/lib/runtime/companion-protocol'

const COPY = {
  zh: {
    unavailable: 'Agent 暂不可用',
    gap: '消息有缺口，已跳过丢失片段',
    memoryDegraded: '记忆持久化降级，仅保留本机会话缓冲',
    memoryError: '记忆异常',
    unsupported: '当前宿主缺少陪玩能力，需要升级游戏插件',
    linkLost: '旅伴连接中断，正在重试…',
    cancelUnknown: '停止回复未确认，等待宿主状态',
  },
  en: {
    unavailable: 'Agent unavailable',
    gap: 'Message gap detected; skipped missing events',
    memoryDegraded: 'Memory persistence degraded; in-memory only',
    memoryError: 'Memory error',
    unsupported: 'This host lacks companion capabilities; upgrade the game plugin',
    linkLost: 'Companion link lost; retrying…',
    cancelUnknown: 'Stop reply not confirmed; waiting for host status',
  },
} as const

type Props = {
  locale: string
  agentReason: string | null
  agentAvailable: boolean | null
  hostStatus: CompanionHostStatus | null
  gap: boolean
  linkLost?: boolean
  cancelUnknown?: boolean
  hostMissing?: boolean
}

export function CompanionNotices({ locale, agentReason, agentAvailable, hostStatus, gap, linkLost, cancelUnknown, hostMissing }: Props) {
  const copy = locale.startsWith('zh') || locale === 'cht' ? COPY.zh : COPY.en
  const unsupported = hostStatus
    ? Object.entries(hostStatus.capabilities || {})
        .filter(([, value]) => value === 'unsupported')
        .map(([key]) => key)
    : []
  const companionUnsupported = unsupported.filter((key) => /chat|route|events|control|companion/i.test(key))
  const missingCore = hostMissing || companionUnsupported.length > 0
  const lines = [
    linkLost ? copy.linkLost : null,
    cancelUnknown ? copy.cancelUnknown : null,
    agentAvailable === false ? agentReason || copy.unavailable : null,
    gap ? copy.gap : null,
    missingCore ? (companionUnsupported.length ? `${copy.unsupported}：${companionUnsupported.join(', ')}` : copy.unsupported) : null,
    hostStatus?.memory.persistence === 'degraded' ? (hostStatus.memory.error ? `${copy.memoryDegraded}：${hostStatus.memory.error}` : copy.memoryDegraded) : null,
    hostStatus?.memory.error && hostStatus.memory.persistence !== 'degraded' ? `${copy.memoryError}：${hostStatus.memory.error}` : null,
  ].filter(Boolean)

  if (!lines.length) return null
  return <MiniPanelAlert>{lines.join(' · ')}</MiniPanelAlert>
}
