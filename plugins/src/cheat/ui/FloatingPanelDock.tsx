import { MiniPanelDock } from '@/components/game-tools/MiniPanelDock'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import type { useToolSettings } from '@/components/game-tools/useToolSettings'

/** 游戏画面上的迷你面板管理；非本机模式不显示，一次保存失败不影响 */
export function FloatingPanelDock({ tools }: { tools: ReturnType<typeof useToolSettings> }) {
  const dock = useToolPanelVisibility('panelDock', tools.settings.panelDockEnabled)
  if (!dock.visible || !tools.loaded || tools.unavailable) return null
  return <MiniPanelDock settings={tools.settings} update={tools.update} />
}
