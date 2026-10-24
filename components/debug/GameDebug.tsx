'use client'

import { useMemo } from 'react'

import { type DebugRegistration, useDebugMenuRegistration } from '@/components/debug/registry'
import { useT } from '@/components/i18n/LocaleProvider'

import { GAME_UI_SCENARIOS, setGameUiDebugScenarioId, useGameUiDebugScenarioId, useGameUiDebugState } from './game-ui-debug'

/** UI-only debug: each scenario is a preview state, never a real command. */
export function GameDebug() {
  const t = useT()
  const active = useGameUiDebugState()
  const scenarioId = useGameUiDebugScenarioId()

  const registration = useMemo<DebugRegistration>(
    () => ({
      id: 'game:ui',
      title: t('debug.gameUiTitle'),
      description: active ? t('debug.gameUiOverridden') : t('debug.gameUiLive'),
      actions: [
        { id: 'live', label: t('debug.gameUiLive'), active: scenarioId === null, run: () => setGameUiDebugScenarioId(null) },
        ...GAME_UI_SCENARIOS.map((scenario) => ({
          id: scenario.id,
          label: t(scenario.labelKey),
          active: scenarioId === scenario.id,
          run: () => setGameUiDebugScenarioId(scenario.id),
        })),
      ],
    }),
    [active, scenarioId, t]
  )

  useDebugMenuRegistration(registration)

  return null
}
