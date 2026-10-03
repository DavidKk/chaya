'use client'

import { useMemo, useState } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { CopyField, SegmentedNav } from '@/components/sk'
import { DEFAULT_SITE_ORIGIN } from '@/constants/brand'
import { usePageOrigin } from '@/hooks/usePageOrigin'
import { SKILL_AGENT_TARGETS, type SkillAgentTargetId, type SkillId, skillInstallCommand } from '@/lib/integration/skills'

/** 「安装到 Agent」：选目标 Agent → curl 命令写入其 skills 目录（标题由所在列头提供） */
export function SkillInstall({ id }: { id: SkillId }) {
  const t = useT()
  const origin = usePageOrigin() || DEFAULT_SITE_ORIGIN
  const [target, setTarget] = useState<SkillAgentTargetId>('agents')
  const items = useMemo(() => SKILL_AGENT_TARGETS.map((item) => ({ id: item.id, label: item.id === 'agents' ? t('integration.targetUniversal') : item.label })), [t])

  return (
    <div className="flex flex-col gap-3">
      <SegmentedNav items={items} value={target} onChange={setTarget} aria-label={t('integration.targetAria')} />
      <CopyField value={skillInstallCommand(origin, id, target)} label={t('integration.installAria')} />
      <p className="m-0 text-xs leading-relaxed text-ink-soft">
        {target === 'agents' ? `${t('integration.targetUniversalHint')} ` : null}
        {t('integration.installEnglishNote')}
      </p>
    </div>
  )
}
