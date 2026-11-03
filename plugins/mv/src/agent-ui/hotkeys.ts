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
      const isField = (node: unknown): node is HTMLElement =>
        node instanceof HTMLElement && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable)

      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      let focusedInput: HTMLElement | null = null
      for (const node of path) {
        if (isField(node)) {
          focusedInput = node
          break
        }
      }
      if (!focusedInput) {
        const ae = document.activeElement
        if (isField(ae)) focusedInput = ae
        else if (ae instanceof HTMLElement && ae.shadowRoot?.activeElement && isField(ae.shadowRoot.activeElement)) {
          focusedInput = ae.shadowRoot.activeElement
        }
      }

      if (focusedInput) {
        if (typeof focusedInput.blur === 'function') {
          focusedInput.blur()
        }
        event.preventDefault()
        event.stopPropagation()
        return
      }

      event.preventDefault()
      event.stopPropagation()
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
