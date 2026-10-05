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
  if (!pause.didPause) return
  pause.didPause = false
  if (typeof Input !== 'undefined' && Input.clear) Input.clear()
  if (typeof SceneManager !== 'undefined' && SceneManager.resume) {
    SceneManager.resume()
  }
}

/**
 * Let the paused game run until `done()` holds (e.g. a reserved map transfer has landed), then stop it again
 * if the overlay is still open. When the overlay did not pause it, just waits for `done()`.
 */
export function runGameUntil(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const paused = pause.didPause && typeof SceneManager !== 'undefined' && !!SceneManager.resume
  if (paused) SceneManager.resume()
  const started = Date.now()
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!done() && Date.now() - started < timeoutMs) return
      clearInterval(timer)
      // A few more frames so the new map is drawn behind the overlay
      setTimeout(() => {
        if (paused && pause.open && pause.didPause && !SceneManager._stopped) SceneManager.stop()
        resolve()
      }, 250)
    }, 50)
  })
}
