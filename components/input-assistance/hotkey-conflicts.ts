'use client'

import { useContext, useEffect, useMemo, useState } from 'react'

import { activeChayaHotkeys, displayKeyChord, GAME_AGENT_TOGGLE_HOTKEY_ID, RUN_HOTKEY_TARGETS } from '@/components/game-edit/run-hotkeys'
import { GameToolTransportContext } from '@/components/game-tools/transport'
import { useT } from '@/components/i18n/LocaleProvider'
import { mergeRules, type ProductBinding, type RuleBinding, ruleBindings } from '@/lib/game/input-assistance'

import { gameKey, loadGlobalConfig, readStored } from './useInputAssistance'

/** Chaya hotkeys that fire right now, labelled for key-mouse conflict warnings */
export function useChayaProductBindings(): ProductBinding[] {
  const t = useT()
  return useMemo(
    () =>
      activeChayaHotkeys().map(({ id, chord }) => {
        const row = RUN_HOTKEY_TARGETS.find((item) => item.id === id)
        const name = row ? t(row.labelKey, row.labelParams) : id === GAME_AGENT_TOGGLE_HOTKEY_ID ? '唤出 Agent 面板' : id
        return { label: `${name}（${displayKeyChord(chord)}）`, chord }
      }),
    [t]
  )
}

/** Key-mouse triggers (global + current game) for marking Chaya hotkeys that collide with them */
export function useAssistRuleBindings(): RuleBinding[] {
  const transport = useContext(GameToolTransportContext)
  const localGlobal = transport?.localGlobal ?? true
  const roomId = transport?.roomId ?? null
  const [bindings, setBindings] = useState<RuleBinding[]>([])

  useEffect(() => {
    let cancelled = false
    const game = readStored(gameKey(roomId))
    setBindings(ruleBindings(game.rules, { runnableOnly: true }))
    loadGlobalConfig(localGlobal)
      .then((global) => {
        if (!cancelled) setBindings(ruleBindings(mergeRules(global.rules, game.rules), { runnableOnly: true }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [localGlobal, roomId])

  return bindings
}
