'use client'

import type { ReactNode } from 'react'

import { useT } from '@/components/i18n/LocaleProvider'
import { legalBar, pageMainFlush, panelBody, panelShell } from '@/components/layoutClasses'
import { LegalNotice } from '@/components/legal/LegalNotice'

import { SettingsSectionNav } from './SettingsSectionNav'

export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useT()
  return (
    <div className={pageMainFlush}>
      <div className={panelShell} role="region" aria-label={t('integration.agentSettingsSection')}>
        <div className={`${panelBody} min-h-0 flex-1 flex-col md:flex-row`}>
          <SettingsSectionNav href="/settings/agents" />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            <LegalNotice kind="agent" className={legalBar} />
          </div>
        </div>
      </div>
    </div>
  )
}
