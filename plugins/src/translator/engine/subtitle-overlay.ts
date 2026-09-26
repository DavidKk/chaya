import { hookMethod } from '../../helpers/game/method-hook'
import type { Subtitle } from './dialogue-subtitles'

/** 局内字幕直接使用 RPG Maker 的画布，随游戏缩放，不接管键盘或鼠标。 */
export function installSubtitleOverlay(): (subtitle: Subtitle | null, messageWindow?: InstanceType<typeof Window_Message>) => void {
  if (typeof Window_Message === 'undefined' || typeof Window_Base === 'undefined') return () => {}
  const host = window as Window & {
    Utils?: { RPGMAKER_NAME?: string }
    Rectangle?: new (x: number, y: number, width: number, height: number) => unknown
    __chayaSubtitleCleanup?: () => void
  }
  host.__chayaSubtitleCleanup?.()
  const proto = Window_Message.prototype
  let subtitle: Subtitle | null = null
  let owner: InstanceType<typeof Window_Message> | undefined
  let messageKey = ''
  let sceneAtStart: unknown
  let overlay: InstanceType<typeof Window_Base> | null = null
  let statusHost: HTMLDivElement | null = null
  let statusStyle: HTMLStyleElement | null = null
  let pointerPosition: { x: number; y: number } | null = null
  let resultTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let phaseTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSince = 0
  let statusGeneration = 0
  let displayed = ''
  let pages: string[][] = []
  let pageIndex = 0
  let nextPageAt = 0
  const lineHeight = 30
  const insetY = 8

  function disposeWindow(win: InstanceType<typeof Window_Base>) {
    win.parent?.removeChild(win)
    const contents = (win as InstanceType<typeof Window_Base> & { _windowContentsSprite?: { bitmap?: { destroy?: () => void } } })._windowContentsSprite?.bitmap
    contents?.destroy?.()
    win.destroy?.()
  }

  function remove() {
    if (!overlay) return
    disposeWindow(overlay)
    overlay = null
    displayed = ''
    pages = []
  }

  const statusLabels = { pending: '翻译中', cached: '词库命中', translated: '已翻译', partial: '部分未译', untranslated: '未译', skipped: '已跳过' } as const
  const statusStageMs = 180
  const statusCss = `
    #chaya-translation-status { position: fixed; z-index: 10; right: 12px; bottom: 12px; width: 28px; height: 28px; border-radius: 999px;
      display: flex; align-items: center; gap: 6px; padding: 6px; pointer-events: none; opacity: 0; transform: scale(.65);
      transition: width 180ms ease, opacity 180ms ease, transform 180ms ease; box-sizing: border-box; overflow: hidden; white-space: nowrap;
      background: rgba(0, 0, 0, .76); color: #a6b3be; }
    #chaya-translation-status[data-corner="top"] { top: 12px; bottom: auto; }
    #chaya-translation-status[data-phase="icon"], #chaya-translation-status[data-phase="expanded"] { opacity: 1; transform: scale(1); }
    #chaya-translation-status[data-phase="expanded"] { width: var(--chaya-status-width); }
    #chaya-translation-status[data-kind="pending"] { color: #55b9ef; }
    #chaya-translation-status[data-kind="cached"] { color: #76d4dc; }
    #chaya-translation-status[data-kind="translated"] { color: #6cdda7; }
    #chaya-translation-status[data-kind="partial"] { color: #f0bf64; }
    #chaya-translation-status[data-kind="untranslated"] { color: #ef8c84; }
    #chaya-translation-status .chaya-status-ring { width: 16px; height: 16px; flex: none; border: 2px solid currentColor; border-radius: 50%;
      display: grid; place-items: center; box-sizing: border-box; }
    #chaya-translation-status[data-kind="pending"] .chaya-status-ring { border-right-color: transparent; }
    #chaya-translation-status[data-kind="pending"][data-phase="icon"] .chaya-status-ring,
    #chaya-translation-status[data-kind="pending"][data-phase="expanded"] .chaya-status-ring { animation: chaya-status-spin 840ms linear infinite; }
    #chaya-translation-status .chaya-status-mark { font: 700 11px/1 sans-serif; }
    #chaya-translation-status .chaya-status-label { flex: none; opacity: 0; color: #fff; font: 700 12px/16px sans-serif;
      transition: opacity 100ms ease; }
    #chaya-translation-status[data-phase="expanded"] .chaya-status-label { opacity: 1; transition-delay: 160ms; }
    @keyframes chaya-status-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { #chaya-translation-status, #chaya-translation-status .chaya-status-label { transition-duration: 1ms; }
      #chaya-translation-status .chaya-status-ring { animation-duration: 2s !important; } }
  `

  function ensureStatusHost() {
    if (statusHost) return statusHost
    statusStyle = document.createElement('style')
    statusStyle.textContent = statusCss
    document.head.appendChild(statusStyle)
    statusHost = document.createElement('div')
    statusHost.id = 'chaya-translation-status'
    statusHost.setAttribute('role', 'status')
    statusHost.innerHTML = '<span class="chaya-status-ring"><span class="chaya-status-mark"></span></span><span class="chaya-status-label"></span>'
    statusHost.dataset.phase = 'hidden'
    document.body.appendChild(statusHost)
    return statusHost
  }

  function hideStatus(immediate = false) {
    statusGeneration++
    if (resultTimer) clearTimeout(resultTimer)
    if (hideTimer) clearTimeout(hideTimer)
    if (phaseTimer) clearTimeout(phaseTimer)
    resultTimer = null
    hideTimer = null
    phaseTimer = null
    if (!statusHost) return
    if (immediate || statusHost.dataset.phase === 'hidden') {
      statusHost.dataset.phase = 'hidden'
      return
    }
    statusHost.dataset.phase = 'icon'
    phaseTimer = setTimeout(() => {
      phaseTimer = null
      if (statusHost) statusHost.dataset.phase = 'hidden'
    }, statusStageMs)
  }

  function setStatusKind(kind: keyof typeof statusLabels) {
    const node = ensureStatusHost()
    node.dataset.kind = kind
    node.setAttribute('aria-label', statusLabels[kind])
    node.style.setProperty('--chaya-status-width', `${28 + 6 + statusLabels[kind].length * 12}px`)
    node.querySelector('.chaya-status-mark')!.textContent =
      kind === 'pending' ? '' : kind === 'cached' || kind === 'translated' ? '✓' : kind === 'partial' ? '!' : kind === 'untranslated' ? '×' : '−'
    node.querySelector('.chaya-status-label')!.textContent = statusLabels[kind]
  }

  function showStatus(kind: keyof typeof statusLabels, expand = true) {
    const node = ensureStatusHost()
    updateStatusCorner()
    const generation = ++statusGeneration
    node.dataset.phase = 'hidden'
    setStatusKind(kind)
    if (kind === 'pending' && !expand) {
      node.setAttribute('aria-label', '处理中')
      node.querySelector('.chaya-status-label')!.textContent = ''
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (generation !== statusGeneration) return
        node.dataset.phase = 'icon'
        if (expand) {
          phaseTimer = setTimeout(() => {
            phaseTimer = null
            if (generation === statusGeneration) node.dataset.phase = 'expanded'
          }, statusStageMs)
        }
      })
    )
    if (kind !== 'pending') hideTimer = setTimeout(() => hideStatus(), 4000)
  }

  function finishStatus(kind: Exclude<keyof typeof statusLabels, 'pending'>) {
    if (!statusHost) return
    if (phaseTimer) clearTimeout(phaseTimer)
    phaseTimer = null
    const generation = ++statusGeneration
    const wasExpanded = statusHost.dataset.phase === 'expanded'
    setStatusKind(kind)
    if (!wasExpanded) {
      statusHost.dataset.phase = 'icon'
      phaseTimer = setTimeout(() => {
        phaseTimer = null
        if (generation === statusGeneration && statusHost) statusHost.dataset.phase = 'expanded'
      }, statusStageMs)
    }
    hideTimer = setTimeout(() => hideStatus(), 4000)
  }

  function updateStatusCorner() {
    if (!statusHost) return
    const nearBottomRight = pointerPosition && pointerPosition.x > window.innerWidth - 76 && pointerPosition.y > window.innerHeight - 87
    statusHost.dataset.corner = nearBottomRight ? 'top' : 'bottom'
  }

  function onPointerMove(event: PointerEvent) {
    pointerPosition = { x: event.clientX, y: event.clientY }
    updateStatusCorner()
  }
  function onPointerOut(event: PointerEvent) {
    if (event.relatedTarget) return
    pointerPosition = null
    updateStatusCorner()
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerout', onPointerOut, { passive: true })

  function linesFor(value: Subtitle, win: InstanceType<typeof Window_Base>): string[] {
    const raw = [value.text, ...value.choices.map((choice, index) => (choice ? `${index + 1}. ${choice}` : ''))].filter(Boolean)
    const maxWidth = win.contents.width - 24
    const lines: string[] = []
    for (const item of raw) {
      for (const paragraph of item.split('\n')) {
        let line = ''
        for (const char of paragraph.replace(/\\(?:[A-Z]+(?:\[[^\]]*\])?|[{}.$|!><^\\])/gi, '')) {
          if (line && win.contents.measureTextWidth(line + char) > maxWidth) {
            lines.push(line)
            line = ''
          }
          line += char
        }
        if (line) lines.push(line)
      }
    }
    return lines
  }

  function paint(win: InstanceType<typeof Window_Base>) {
    win.contents.clear()
    win.contents.fillRect(0, 0, win.contents.width, win.contents.height, 'rgba(0, 0, 0, 1)')
    pages[pageIndex].forEach((line, index) =>
      win.contents.drawText(line, 12, insetY + index * lineHeight, win.contents.width - 24, lineHeight, subtitle?.replace ? 'left' : 'center')
    )
    nextPageAt = Date.now() + Math.max(4000, pages[pageIndex].length * 1800)
  }

  function render(messageWindow: InstanceType<typeof Window_Message>) {
    const scene = typeof SceneManager === 'undefined' ? null : SceneManager._scene
    const currentKey = typeof $gameMessage === 'undefined' ? '' : JSON.stringify([$gameMessage._texts || [], $gameMessage._choices || []])
    if (subtitle && (currentKey !== messageKey || scene !== sceneAtStart || messageWindow !== owner)) {
      subtitle = null
      hideStatus()
    }
    if (!subtitle || !scene || scene !== sceneAtStart || messageWindow !== owner || currentKey !== messageKey || typeof Graphics === 'undefined') {
      remove()
      return
    }
    const choiceWindow = (messageWindow._choiceWindow || messageWindow._choiceListWindow) as { active?: boolean; index?: () => number } | undefined
    const selected = choiceWindow?.active ? (choiceWindow.index?.() ?? -1) : -1
    const visible: Subtitle = subtitle.replace
      ? { text: subtitle.text, choices: [], replace: true }
      : selected >= 0
        ? { text: subtitle.choiceHelp ? subtitle.text : '', choices: subtitle.choices.map((value, index) => (index === selected ? value : '')) }
        : { text: subtitle.text, choices: [] }
    if (!visible.text && !visible.choices.some(Boolean)) {
      remove()
      return
    }
    const key = JSON.stringify([visible, Graphics.boxWidth, Graphics.boxHeight, messageWindow.x, messageWindow.y, messageWindow.width, messageWindow.height])
    if (overlay && overlay.parent !== scene) remove()
    if (overlay && displayed === key) {
      if (pages.length > 1 && Date.now() >= nextPageAt) {
        pageIndex = (pageIndex + 1) % pages.length
        paint(overlay)
      }
      return
    }
    remove()

    const replacingText = visible.replace && !!visible.text
    const faceOffset = replacingText && typeof $gameMessage !== 'undefined' && $gameMessage.faceName?.() ? 168 : 0
    const width = replacingText ? Math.max(1, messageWindow.width - faceOffset) : Math.max(1, Math.min(760, Graphics.boxWidth - 24))
    const x = replacingText ? messageWindow.x + faceOffset : Math.max(0, Math.floor((Graphics.boxWidth - width) / 2))
    const small = host.Utils?.RPGMAKER_NAME === 'MZ' && host.Rectangle
    const win = small ? new Window_Base(new host.Rectangle!(x, 0, width, 224)) : new Window_Base(x, 0, width, 224)
    win.opacity = 0
    win.backOpacity = 0
    win.contents.fontSize = 20
    const lines = linesFor(visible, win)
    if (!lines.length) {
      disposeWindow(win)
      return
    }
    // MV 默认每侧 18px、MZ 12px；游戏还可覆写 padding，不能用固定总高度代替内容高度。
    const padding = Number.isFinite(win.padding) ? win.padding : Math.max(0, (win.height - win.contents.height) / 2)
    const above = messageWindow.y >= Graphics.boxHeight / 2
    const freeHeight = replacingText ? messageWindow.height : above ? messageWindow.y - 24 : Graphics.boxHeight - messageWindow.y - messageWindow.height - 24
    const available = Math.min(Graphics.boxHeight - 24, Math.max(lineHeight + insetY * 2 + padding * 2, freeHeight))
    const maxLines = Math.max(1, Math.floor((available - padding * 2 - insetY * 2) / lineHeight))
    for (let index = 0; index < lines.length; index += maxLines) pages.push(lines.slice(index, index + maxLines))
    pageIndex = 0
    const height = replacingText ? messageWindow.height : Math.min(lines.length, maxLines) * lineHeight + insetY * 2 + padding * 2
    win.move(x, replacingText ? messageWindow.y : above ? 12 : Math.max(0, Graphics.boxHeight - height - 12), width, height)
    win.createContents()
    win.contents.fontSize = 20
    win.contents.textColor = '#ffffff'
    win.contents.outlineColor = 'rgba(0, 0, 0, 0.9)'
    paint(win)
    scene.addChild(win)
    overlay = win
    displayed = key
  }

  const removeUpdate = hookMethod(
    proto,
    'update',
    (original) =>
      function (...args: unknown[]) {
        const result = original.apply(this, args)
        render(this)
        return result
      }
  )
  host.__chayaSubtitleCleanup = () => {
    if (typeof window.removeEventListener === 'function') window.removeEventListener('pointermove', onPointerMove)
    if (typeof window.removeEventListener === 'function') window.removeEventListener('pointerout', onPointerOut)
    removeUpdate()
    remove()
    hideStatus(true)
    statusHost?.remove()
    statusStyle?.remove()
    statusHost = null
    statusStyle = null
  }
  return (next, messageWindow) => {
    const keepPending = !!next?.pending && !!subtitle?.pending && statusHost?.dataset.kind === 'pending'
    const finishPending = !!next?.badge && !!subtitle?.pending && statusHost?.dataset.kind === 'pending'
    if (!keepPending && !finishPending) hideStatus(next ? true : false)
    subtitle = next
    if (next?.pending && !keepPending) {
      pendingSince = Date.now()
      showStatus('pending')
    } else if (next?.badge) {
      if (!finishPending) {
        pendingSince = Date.now()
        showStatus('pending', false)
      } else if (phaseTimer && statusHost?.dataset.phase !== 'expanded') {
        clearTimeout(phaseTimer)
        phaseTimer = null
      }
      const badge = next.badge
      const remaining = Math.max(0, statusStageMs - (Date.now() - pendingSince))
      if (remaining === 0) finishStatus(badge)
      else {
        resultTimer = setTimeout(() => {
          resultTimer = null
          if (subtitle !== next) return
          finishStatus(badge)
        }, remaining)
      }
    }
    if (messageWindow) owner = messageWindow
    if (next && typeof $gameMessage !== 'undefined') messageKey = JSON.stringify([$gameMessage._texts || [], $gameMessage._choices || []])
    if (next) sceneAtStart = typeof SceneManager === 'undefined' ? null : SceneManager._scene
    if (!next) {
      remove()
    }
  }
}
