'use client'

import { useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { CopyField, SegmentedNav } from '@/components/sk'
import { DEFAULT_SITE_ORIGIN } from '@/constants/brand'
import { usePageOrigin } from '@/hooks/usePageOrigin'
import { SKILL_AGENT_TARGETS, type SkillAgentTargetId, type SkillId, skillInstallCommand } from '@/lib/integration/skills'

/** 「安装到 Agent」：选目标 Agent → curl 命令写入其 skills 目录 */
export function SkillInstall({ id }: { id: SkillId }) {
  const t = useT()
  const origin = usePageOrigin() || DEFAULT_SITE_ORIGIN
  const [target, setTarget] = useState<SkillAgentTargetId>('cursor')
  const items = useMemo(() => SKILL_AGENT_TARGETS.map((item) => ({ id: item.id, label: item.label })), [])

  return (
    <section className="flex flex-col gap-2 rounded-[0.35rem] border border-line bg-panel px-4 py-3" aria-label={t('integration.installTitle')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[13px] font-semibold text-ink">{t('integration.installTitle')}</h2>
        <SegmentedNav items={items} value={target} onChange={setTarget} aria-label={t('integration.targetAria')} />
      </div>
      <p className="m-0 text-xs text-ink-soft">{t('integration.installHint')}</p>
      <CopyField value={skillInstallCommand(origin, id, target)} label={t('integration.installAria')} />
    </section>
  )
}
