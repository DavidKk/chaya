'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { MINI_PANEL_IDS, type MiniPanelId, type ToolSettings } from '@/lib/game-agent/tool-settings'

import type { ToolSettingsPatch } from './useToolSettings'

export type { MiniPanelId }

/** 可开关的面板：四个迷你面板加迷你面板管理 */
export type ToolPanelId = MiniPanelId | 'panelDock'

const TOOL_PANEL_IDS: readonly ToolPanelId[] = [...MINI_PANEL_IDS, 'panelDock']

type PanelField = 'miniMapEnabled' | 'companionEnabled' | 'autoSavePanelEnabled' | 'quickSavePanelEnabled' | 'panelDockEnabled'

const TOOL_PANEL_FIELD: Record<ToolPanelId, PanelField> = {
  miniMap: 'miniMapEnabled',
  companion: 'companionEnabled',
  autoSaves: 'autoSavePanelEnabled',
  quickSaves: 'quickSavePanelEnabled',
  panelDock: 'panelDockEnabled',
}

type Size = { width: number; height: number }

type ToolPanelFrame = {
  /** 位置与尺寸的本地存储 key */
  storageKey: string
  edge: 'top' | 'bottom'
  side: 'left' | 'right'
  defaultSize: Size
}

/** 所有迷你面板共用的尺寸范围 */
export const TOOL_PANEL_SIZE = { min: { width: 220, height: 160 }, max: { width: 640, height: 640 } } as const

/** 首次打开的位置：迷你地图右上、旅伴右下、自动存档左上、快速存档左下 */
export const TOOL_PANEL_FRAME: Record<MiniPanelId, ToolPanelFrame> = {
  miniMap: { storageKey: 'chaya.minimap.frame.v1', edge: 'top', side: 'right', defaultSize: { width: 320, height: 300 } },
  companion: { storageKey: 'chaya.companion.frame.v1', edge: 'bottom', side: 'right', defaultSize: { width: 300, height: 260 } },
  autoSaves: { storageKey: 'chaya.saves.auto.frame.v1', edge: 'top', side: 'left', defaultSize: { width: 260, height: 280 } },
  quickSaves: { storageKey: 'chaya.saves.quick.frame.v1', edge: 'bottom', side: 'left', defaultSize: { width: 260, height: 300 } },
}

export function isToolPanelId(value: string): value is ToolPanelId {
  return (TOOL_PANEL_IDS as readonly string[]).includes(value)
}

const DISMISS_EVENT = 'chaya:tool-panel-dismiss'

/**
 * 关闭按钮只隐藏到本次游戏结束。
 * 作弊浮层与 Agent 浮层是同一窗口里的两个 React 根，状态放在模块里并用 window 事件通知。
 */
const dismissed = new Set<ToolPanelId>()

function setDismissed(id: ToolPanelId, value: boolean) {
  if (dismissed.has(id) === value) return
  if (value) dismissed.add(id)
  else dismissed.delete(id)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DISMISS_EVENT))
}

function subscribe(onChange: () => void) {
  window.addEventListener(DISMISS_EVENT, onChange)
  return () => window.removeEventListener(DISMISS_EVENT, onChange)
}

export function isToolPanelVisible(id: ToolPanelId, settings: ToolSettings): boolean {
  return settings[TOOL_PANEL_FIELD[id]] && !dismissed.has(id)
}

/**
 * 快捷键 / 管理条：可见则关闭开关，否则取消本次隐藏并打开开关。
 * 开关在轮到保存时才按最新设置决定，连点同一个按钮每次都生效。
 */
export function toggleToolPanel(id: ToolPanelId, settings: ToolSettings, update: (patch: ToolSettingsPatch) => Promise<void>): Promise<void> {
  const field = TOOL_PANEL_FIELD[id]
  if (settings[field] && dismissed.has(id)) {
    setDismissed(id, false)
    return Promise.resolve()
  }
  return update((current) => {
    if (isToolPanelVisible(id, current)) return { [field]: false }
    setDismissed(id, false)
    return { [field]: true }
  })
}

/** 「关闭全部」：一次写入四个迷你面板开关，迷你面板管理不受影响 */
export function closeAllMiniPanels(update: (patch: Partial<ToolSettings>) => Promise<void>): Promise<void> {
  return update(Object.fromEntries(MINI_PANEL_IDS.map((id) => [TOOL_PANEL_FIELD[id], false])))
}

/** 只看开关：被关闭按钮临时隐藏的面板仍算开启 */
export function anyMiniPanelEnabled(settings: ToolSettings): boolean {
  return MINI_PANEL_IDS.some((id) => settings[TOOL_PANEL_FIELD[id]])
}

export function useToolPanelVisibility(id: ToolPanelId, enabled: boolean) {
  const isDismissed = useSyncExternalStore(
    subscribe,
    () => dismissed.has(id),
    () => false
  )
  useEffect(() => {
    if (!enabled) setDismissed(id, false)
  }, [id, enabled])
  const dismiss = useCallback(() => setDismissed(id, true), [id])
  return { visible: enabled && !isDismissed, dismiss }
}
