import { isInputRecording } from '@/lib/game/input-assistance/recording'

import { isGameAgentUiOpen, toggleGameAgentUi } from './mount'

export function startGameAgentHotkeys() {
  const toggle = () => toggleGameAgentUi()
  const onKey = (event: KeyboardEvent) => {
    if (isInputRecording()) return
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      event.stopImmediatePropagation()
      toggleGameAgentUi()
      return
    }
    if (event.key === 'Escape' && isGameAgentUiOpen()) {
      const path = event.composedPath()
      if (path.some((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return
      event.preventDefault()
      toggleGameAgentUi()
    }
  }
  window.addEventListener('chaya:game-agent-toggle', toggle)
  window.addEventListener('keydown', onKey, true)
  return () => {
    window.removeEventListener('chaya:game-agent-toggle', toggle)
    window.removeEventListener('keydown', onKey, true)
  }
}
