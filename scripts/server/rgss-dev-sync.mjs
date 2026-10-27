#!/usr/bin/env node
/**
 * Dev-only client for the server-authoritative RGSS sync endpoint.
 *
 * The endpoint owns game state and install decisions because the Next server
 * process is the only process that knows whether an RGSS game is running.
 * Uses SSE to stream sync events without spamming dev server request logs.
 */
const port = process.env.CHAYA_PORT || process.env.PORT || '3000'
const endpoint = `http://127.0.0.1:${port}/api/dev/rgss-sync`

let lastStatus = ''

/** @param {string} message */
function status(message) {
  if (message === lastStatus) return
  lastStatus = message
  console.log(`[rgss-sync] ${message}`)
}

/** @param {unknown} files */
function listSuffix(files) {
  return Array.isArray(files) && files.length ? `: ${files.join(', ')}` : ''
}

/** @param {unknown} files */
function deferredSuffix(files) {
  return Array.isArray(files) && files.length ? `; deferred until game exit: ${files.join(', ')}` : ''
}

/**
 * Handle sync payload from either SSE stream or fallback request.
 * @param {any} body
 */
function handleSyncPayload(body) {
  if (!body) return
  if (!body.ok) {
    status(`sync error: ${body.error?.message || 'unknown'}`)
    return
  }
  if (body.action === 'idle') {
    status(body.reason || 'idle')
  } else if (body.action === 'installed') {
    status(`installed (${body.copied?.join(', ') || 'startup'})`)
  } else if (body.action === 'hot') {
    status(`hot reloaded (${body.copied?.join(', ') || 'reloadable Ruby'})${deferredSuffix(body.deferred)}`)
  } else if (body.action === 'deferred') {
    status(`${body.reason || 'deferred until game exit'}${listSuffix(body.deferred)}`)
  }
}

let stopped = false
const abortController = new AbortController()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopped = true
    abortController.abort()
    process.exit(0)
  })
}

async function connectSse() {
  while (!stopped) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'text/event-stream' },
        signal: abortController.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!stopped) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() ?? ''

        for (const block of blocks) {
          if (!block.trim()) continue
          let event = 'message'
          let data = ''
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              data += (data ? '\n' : '') + line.slice(5).trim()
            }
          }
          if (event === 'sync' && data) {
            try {
              handleSyncPayload(JSON.parse(data))
            } catch {
              /* ignore parse error */
            }
          }
        }
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    } catch (error) {
      if (stopped) break
      const message = error instanceof Error ? error.message : String(error)
      status(`waiting for dev server (${message})`)
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
  }
}

void connectSse()
