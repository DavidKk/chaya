'use client'

import { useSyncExternalStore } from 'react'

export type GameUiDebugState = {
  mode: 'local' | 'remote'
  rgss: boolean
  hasShell: boolean
  bundled: boolean
  online: boolean
  pending: boolean
  plugins: 'unavailable' | 'missing' | 'outdated' | 'ready'
  canInstallShell: boolean
  canUninstallShell: boolean
}

type GameUiScenarioLabel =
  | 'debug.gameUiNoShell'
  | 'debug.gameUiBundled'
  | 'debug.gameUiRemote'
  | 'debug.gameUiRgss'
  | 'debug.gameUiConnecting'
  | 'debug.gameUiOnline'
  | 'debug.gameUiPluginsReady'
  | 'debug.gameUiPluginsOutdated'

export type GameUiScenario = { id: string; labelKey: GameUiScenarioLabel; state: GameUiDebugState }

export const GAME_UI_SCENARIOS: GameUiScenario[] = [
  {
    id: 'no-shell',
    labelKey: 'debug.gameUiNoShell',
    state: { mode: 'local', rgss: false, hasShell: false, bundled: false, online: false, pending: false, plugins: 'unavailable', canInstallShell: true, canUninstallShell: false },
  },
  {
    id: 'bundled',
    labelKey: 'debug.gameUiBundled',
    state: { mode: 'local', rgss: false, hasShell: true, bundled: true, online: false, pending: false, plugins: 'outdated', canInstallShell: false, canUninstallShell: false },
  },
  {
    id: 'remote',
    labelKey: 'debug.gameUiRemote',
    state: { mode: 'remote', rgss: false, hasShell: true, bundled: false, online: false, pending: false, plugins: 'unavailable', canInstallShell: false, canUninstallShell: false },
  },
  {
    id: 'rgss',
    labelKey: 'debug.gameUiRgss',
    state: { mode: 'local', rgss: true, hasShell: true, bundled: false, online: false, pending: false, plugins: 'unavailable', canInstallShell: false, canUninstallShell: false },
  },
  {
    id: 'connecting',
    labelKey: 'debug.gameUiConnecting',
    state: { mode: 'local', rgss: false, hasShell: true, bundled: false, online: false, pending: true, plugins: 'ready', canInstallShell: false, canUninstallShell: true },
  },
  {
    id: 'online',
    labelKey: 'debug.gameUiOnline',
    state: { mode: 'local', rgss: false, hasShell: true, bundled: false, online: true, pending: false, plugins: 'ready', canInstallShell: false, canUninstallShell: true },
  },
  {
    id: 'plugins-ready',
    labelKey: 'debug.gameUiPluginsReady',
    state: { mode: 'local', rgss: false, hasShell: true, bundled: false, online: false, pending: false, plugins: 'ready', canInstallShell: false, canUninstallShell: true },
  },
  {
    id: 'plugins-outdated',
    labelKey: 'debug.gameUiPluginsOutdated',
    state: { mode: 'local', rgss: false, hasShell: true, bundled: false, online: false, pending: false, plugins: 'outdated', canInstallShell: false, canUninstallShell: true },
  },
]

let currentId: string | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getGameUiDebugScenarioId() {
  return currentId
}

export function getGameUiDebugState(): GameUiDebugState | null {
  if (currentId === null) return null
  return GAME_UI_SCENARIOS.find((scenario) => scenario.id === currentId)?.state ?? null
}

export function setGameUiDebugScenarioId(id: string | null) {
  if (id !== null && !GAME_UI_SCENARIOS.some((scenario) => scenario.id === id)) return
  currentId = id
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** UI-only debug: a preview state that never issues real commands. */
export function useGameUiDebugState(): GameUiDebugState | null {
  return useSyncExternalStore(subscribe, getGameUiDebugState, getGameUiDebugState)
}

export function useGameUiDebugScenarioId(): string | null {
  return useSyncExternalStore(subscribe, getGameUiDebugScenarioId, getGameUiDebugScenarioId)
}
