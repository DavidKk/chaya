import { AutoSaveMiniPanel, QuickSaveMiniPanel } from '@/components/game-saves/GameSavesMiniPanels'
import { useGameSaveActions } from '@/components/game-saves/useGameSaveActions'
import { useGameSaves } from '@/components/game-saves/useGameSaves'
import { useToolPanelVisibility } from '@/components/game-tools/tool-panels'
import type { ToolSettings } from '@/lib/game-agent/tool-settings'

type Panel = ReturnType<typeof useToolPanelVisibility>

function Panels({ auto, quick }: { auto: Panel; quick: Panel }) {
  const saves = useGameSaves()
  const actions = useGameSaveActions(saves)
  return (
    <>
      {auto.visible ? <AutoSaveMiniPanel saves={saves} actions={actions} onClose={auto.dismiss} /> : null}
      {quick.visible ? <QuickSaveMiniPanel saves={saves} actions={actions} onClose={quick.dismiss} /> : null}
    </>
  )
}

/** 游戏画面上的自动存档 / 快速存档迷你面板；都不显示时不取快照、不订阅状态 */
export function FloatingGameSaves({ settings }: { settings: ToolSettings }) {
  const auto = useToolPanelVisibility('autoSaves', settings.autoSavePanelEnabled)
  const quick = useToolPanelVisibility('quickSaves', settings.quickSavePanelEnabled)
  if (!auto.visible && !quick.visible) return null
  return <Panels auto={auto} quick={quick} />
}
