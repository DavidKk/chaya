const isolatedRoots = new WeakSet<ShadowRoot>()

/** Keep game-level keyboard listeners from cancelling text editing inside plugin overlays. */
export function isolateEditableKeys(shadow: ShadowRoot): void {
  if (isolatedRoots.has(shadow)) return
  isolatedRoots.add(shadow)

  const stopEditableKey = (event: Event) => {
    const editable = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement || (node instanceof HTMLElement && node.isContentEditable)
      )
    if (editable) event.stopPropagation()
  }

  shadow.addEventListener('keydown', stopEditableKey)
  shadow.addEventListener('keyup', stopEditableKey)
}
