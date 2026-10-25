#!/usr/bin/env node
/**
 * Dev-only client for the server-authoritative RGSS sync endpoint.
 *
 * The endpoint owns game state and install decisions because the Next server
 * process is the only process that knows whether an RGSS game is running.
 */
const port = process.env.CHAYA_PORT || process.env.PORT || '3000'
const endpoint = `http://127.0.0.1:${port}/api/dev/rgss-sync`

let busy = false
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

async function tick() {
  if (busy) return
  busy = true
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.ok) {
      throw new Error(body?.error?.message || `HTTP ${response.status}`)
    }
    if (body.action === 'idle') {
      status(body.reason || 'idle')
    } else if (body.action === 'installed') {
      status(`installed (${body.copied.join(', ') || 'startup'})`)
    } else if (body.action === 'hot') {
      status(`hot reloaded (${body.copied.join(', ') || 'reloadable Ruby'})${deferredSuffix(body.deferred)}`)
    } else {
      status(`${body.reason || 'deferred until game exit'}${listSuffix(body.deferred)}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    status(`waiting for dev server (${message})`)
  } finally {
    busy = false
  }
}

setInterval(() => void tick(), 1_200)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0))
void tick()
