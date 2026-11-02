declare const TouchInput: { clear?: () => void } | undefined
/** The overlay stops the game loop while it is open; operations that need the game to tick can run it briefly */
const pause = { didPause: false, open: false }

export function pauseGame() {
  pause.open = true
  if (typeof SceneManager === 'undefined') return
  if (!SceneManager._stopped) {
    pause.didPause = true
    SceneManager.stop()
  }
}

export function resumeGame() {
  pause.open = false
  pause.didPause = false
  if (typeof Input !== 'undefined' && Input.clear) {
    try {
      Input.clear()
    } catch {
      /* */
    }
  }
  if (typeof TouchInput !== 'undefined' && TouchInput.clear) {
    try {
      TouchInput.clear()
    } catch {
      /* */
    }
  }
  if (typeof SceneManager !== 'undefined') {
    if (typeof (SceneManager as any).resume === 'function') {
      try {
        ;(SceneManager as any).resume()
      } catch {
        /* */
      }
    }
    const sm = SceneManager as any
    if (sm._stopped) {
      sm._stopped = false
      if (typeof sm.requestUpdate === 'function') {
        try {
          sm.requestUpdate()
        } catch {
          /* */
        }
      }
    }
  }
}

/**
 * Let the paused game run until `done()` holds (e.g. a reserved map transfer has landed), then stop it again
 * if the overlay is still open. When the overlay did not pause it, just waits for `done()`.
 */
export function runGameUntil(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const wasPaused = pause.didPause
  if (wasPaused) resumeGame()
  const started = Date.now()
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!done() && Date.now() - started < timeoutMs) return
      clearInterval(timer)
      // A few more frames so the new map is drawn behind the overlay
      setTimeout(() => {
        if (wasPaused && pause.open && typeof SceneManager !== 'undefined' && !SceneManager._stopped) {
          pauseGame()
        }
        resolve()
      }, 250)
    }, 50)
  })
}
