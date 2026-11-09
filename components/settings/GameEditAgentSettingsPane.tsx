'use client'

import { type ReactNode, useEffect } from 'react'

import type { GameAgentRequest } from '@/components/game-agent/GameAgentWorkspace'
import { GameSavesPage } from '@/components/game-saves/GameSavesPage'
import { MiniPanelsPage } from '@/components/game-tools/MiniPanelsPage'
import { useT } from '@/components/i18n/LocaleProvider'
import { ASSIST_SECTIONS, type AssistSection, DEFAULT_ASSIST_SECTION, isAssistSection } from '@/components/input-assistance/assist-sections'
import { InputAssistancePage } from '@/components/input-assistance/InputAssistancePage'
import { SectionSideNav, sectionSideNavItemClass, SectionSideNavItemContent } from '@/components/SectionSideNav'
import { Tooltip } from '@/components/sk'
import { useViewState } from '@/lib/view-state'

import { EnhanceSettingsView } from './EnhanceSettingsView'
import { FloatingBallSettingsView } from './FloatingBallSettingsView'
import { ToolSettingsView } from './ToolSettingsView'

/** 局内浮层「辅助」：与 Web `/assist/*` 同一组分区与组件，只换外壳 */
export function GameEditAgentSettingsPane({ request, hotkeys }: { request: GameAgentRequest; hotkeys: ReactNode }) {
  const t = useT()
  const [section, setSection] = useViewState<AssistSection>('settings.section', DEFAULT_ASSIST_SECTION, isAssistSection)

  useEffect(() => {
    const reset = () => {
      setSection(DEFAULT_ASSIST_SECTION)
    }
    window.addEventListener('chaya:game-settings-opened', reset)
    return () => window.removeEventListener('chaya:game-settings-opened', reset)
  }, [setSection])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper-2 md:flex-row">
      <SectionSideNav label={t('nav.assist')} mobile>
        {ASSIST_SECTIONS.map(({ id, labelKey, icon: Icon }) => {
          const label = t(labelKey)
          const active = section === id
          return (
            <li key={id}>
              <Tooltip content={label} placement="right">
                <button
                  type="button"
                  aria-label={label}
                  aria-current={active ? 'page' : undefined}
                  className={`${sectionSideNavItemClass(active)} cursor-pointer`}
                  onClick={() => {
                    setSection(id)
                  }}
                >
                  <SectionSideNavItemContent active={active} icon={<Icon size={17} />} />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </SectionSideNav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'hotkeys' ? (
          hotkeys
        ) : section === 'key-mouse' ? (
          <InputAssistancePage />
        ) : section === 'saves' ? (
          <GameSavesPage onOpenHotkeys={() => setSection('hotkeys')} request={request} />
        ) : section === 'panels' ? (
          <MiniPanelsPage request={request} />
        ) : section === 'floating-ball' ? (
          <FloatingBallSettingsView request={request} />
        ) : section === 'enhance' ? (
          <EnhanceSettingsView request={request} />
        ) : (
          <ToolSettingsView page={section} request={request} />
        )}
      </div>
    </div>
  )
}
