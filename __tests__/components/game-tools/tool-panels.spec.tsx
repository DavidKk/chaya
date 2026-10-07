/** @jest-environment jsdom */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { RUN_HOTKEY_TARGETS, toolPanelFromHotkeyTarget, toolPanelHotkeyId } from '@/components/game-edit/run-hotkeys'
import { anyMiniPanelEnabled, closeAllMiniPanels, isToolPanelId, isToolPanelVisible, toggleToolPanel, useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import type { ToolSettingsPatch } from '@/components/game-tools/useToolSettings'
import { DEFAULT_TOOL_SETTINGS, normalizeToolSettings, type ToolSettings } from '@/lib/game-agent/tool-settings'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let host: HTMLDivElement
let root: Root
let panel: ReturnType<typeof useToolPanelVisibility>

function Probe({ enabled }: { enabled: boolean }) {
  const value = useToolPanelVisibility('autoSaves', enabled)
  useEffect(() => {
    panel = value
  })
  return null
}

const on: ToolSettings = { ...DEFAULT_TOOL_SETTINGS, autoSavePanelEnabled: true }

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

it('defaults both save panels to off and keeps unknown values off', () => {
  expect(normalizeToolSettings({})).toMatchObject({ autoSavePanelEnabled: false, quickSavePanelEnabled: false })
  expect(normalizeToolSettings({ autoSavePanelEnabled: 'yes', quickSavePanelEnabled: true })).toMatchObject({ autoSavePanelEnabled: false, quickSavePanelEnabled: true })
})

it('hides a panel for the session when closed and shows it again after the switch is turned off and on', async () => {
  await act(async () => root.render(<Probe enabled />))
  expect(panel.visible).toBe(true)
  await act(async () => panel.dismiss())
  expect(panel.visible).toBe(false)
  expect(isToolPanelVisible('autoSaves', on)).toBe(false)
  await act(async () => root.render(<Probe enabled={false} />))
  await act(async () => root.render(<Probe enabled />))
  expect(panel.visible).toBe(true)
})

function settingsStore(initial: ToolSettings) {
  let current = initial
  const update = jest.fn(async (patch: ToolSettingsPatch) => {
    current = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) }
  })
  return { update, get: () => current }
}

it('hotkey turns a visible panel off, and reveals a dismissed or disabled one', async () => {
  await act(async () => root.render(<Probe enabled />))
  const visibleStore = settingsStore(on)
  await toggleToolPanel('autoSaves', on, visibleStore.update)
  expect(visibleStore.get().autoSavePanelEnabled).toBe(false)

  const dismissedStore = settingsStore(on)
  await act(async () => panel.dismiss())
  await act(async () => toggleToolPanel('autoSaves', on, dismissedStore.update))
  expect(dismissedStore.update).not.toHaveBeenCalled()
  expect(panel.visible).toBe(true)

  const offStore = settingsStore(DEFAULT_TOOL_SETTINGS)
  await toggleToolPanel('autoSaves', DEFAULT_TOOL_SETTINGS, offStore.update)
  expect(offStore.get().autoSavePanelEnabled).toBe(true)
})

it('flips again on a second quick click made before the first save lands', async () => {
  await act(async () => root.render(<Probe enabled />))
  const store = settingsStore(on)
  await Promise.all([toggleToolPanel('autoSaves', on, store.update), toggleToolPanel('autoSaves', on, store.update)])
  expect(store.get().autoSavePanelEnabled).toBe(true)
  expect(store.update).toHaveBeenCalledTimes(2)
})

it('lists the mini panel hotkeys, then the manager, right after the panel group', () => {
  const ids = RUN_HOTKEY_TARGETS.map((target) => target.id)
  expect(ids.slice(2, 7)).toEqual(['miniMap', 'companion', 'autoSaves', 'quickSaves', 'panelDock'].map((id) => toolPanelHotkeyId(id as 'miniMap')))
  expect(RUN_HOTKEY_TARGETS.slice(2, 7).every((target) => target.kind === 'ui' && target.groupKey === 'edit.groupMiniPanels')).toBe(true)
  expect(toolPanelFromHotkeyTarget('panel:quickSaves')).toBe('quickSaves')
  expect(toolPanelFromHotkeyTarget('toggle')).toBeNull()
  expect(isToolPanelId('panelDock')).toBe(true)
})

it('normalizes the manager settings', () => {
  expect(normalizeToolSettings({})).toMatchObject({ panelDockEnabled: false, panelDockHiddenItems: [], panelDockOrientation: 'horizontal' })
  expect(normalizeToolSettings({ panelDockHiddenItems: ['closeAll', 'nope', 'miniMap', 'miniMap'], panelDockOrientation: 'diagonal' })).toMatchObject({
    panelDockHiddenItems: ['miniMap', 'closeAll'],
    panelDockOrientation: 'horizontal',
  })
  expect(normalizeToolSettings({ panelDockHiddenItems: 'all', panelDockOrientation: 'vertical' })).toMatchObject({ panelDockHiddenItems: [], panelDockOrientation: 'vertical' })
})

it('closes all four mini panels but not the manager, and counts dismissed panels as still on', async () => {
  const update = jest.fn(async () => {})
  await closeAllMiniPanels(update)
  expect(update).toHaveBeenCalledWith({ miniMapEnabled: false, companionEnabled: false, autoSavePanelEnabled: false, quickSavePanelEnabled: false })
  await act(async () => root.render(<Probe enabled />))
  await act(async () => panel.dismiss())
  expect(anyMiniPanelEnabled(on)).toBe(true)
  expect(anyMiniPanelEnabled({ ...DEFAULT_TOOL_SETTINGS, panelDockEnabled: true })).toBe(false)
})
