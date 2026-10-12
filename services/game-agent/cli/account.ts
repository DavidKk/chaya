import type { AgentAccountSummary } from '@/lib/game-agent/providers'

/** Only a hint ever leaves the service: first character of the local part plus the domain. */
export function maskEmail(email: unknown): string | undefined {
  if (typeof email !== 'string') return undefined
  const match = email.trim().match(/^([^@\s]+)@([^@\s]+)$/)
  if (!match) return undefined
  return `${match[1][0]}***@${match[2]}`
}

export function accountSummary(email: unknown, plan: unknown): AgentAccountSummary {
  const summary: AgentAccountSummary = {}
  const emailHint = maskEmail(email)
  if (emailHint) summary.emailHint = emailHint
  if (typeof plan === 'string' && plan.trim() && plan !== 'unknown') summary.plan = plan.trim().slice(0, 40)
  return summary
}
