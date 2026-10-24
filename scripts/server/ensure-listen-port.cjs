'use strict'

const { execFileSync } = require('node:child_process')
const { createInterface } = require('node:readline')
const { setTimeout: sleep } = require('node:timers/promises')

/**
 * Parse `lsof -Fpc` stdout into pid/command pairs.
 * @param {string} stdout
 * @param {{ selfPid?: number, parentPid?: number }} [opts]
 */
function parseLsofListeners(stdout, opts = {}) {
  const selfPid = opts.selfPid ?? process.pid
  const parentPid = opts.parentPid ?? process.ppid
  const found = []
  let pid = 0
  let command = ''
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (line.startsWith('p')) {
      if (pid) found.push({ pid, command: command || `pid ${pid}` })
      pid = Number(line.slice(1))
      command = ''
      continue
    }
    if (line.startsWith('c')) command = line.slice(1)
  }
  if (pid) found.push({ pid, command: command || `pid ${pid}` })
  const unique = new Map()
  for (const item of found) {
    if (!Number.isFinite(item.pid) || item.pid <= 0) continue
    if (item.pid === selfPid || item.pid === parentPid) continue
    unique.set(item.pid, item)
  }
  return [...unique.values()]
}

function processCommand(pid) {
  try {
    return (
      execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || ''
    )
  } catch {
    return ''
  }
}

/** List TCP listen PIDs on `port` (macOS / Linux via lsof). */
function listPortListeners(port) {
  const portNumber = Number(port)
  if (!Number.isFinite(portNumber) || portNumber <= 0) return []
  let stdout = ''
  try {
    stdout = execFileSync('lsof', ['-nP', `-iTCP:${portNumber}`, '-sTCP:LISTEN', '-Fpc'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 1) return []
    return []
  }
  return parseLsofListeners(stdout).map((item) => ({
    ...item,
    command: processCommand(item.pid) || item.command,
  }))
}

function killCommandForPort(port) {
  return `kill $(lsof -t -iTCP:${port} -sTCP:LISTEN)`
}

function killListeners(listeners, signal = 'SIGTERM') {
  for (const { pid } of listeners) {
    try {
      process.kill(pid, signal)
    } catch {
      /* Already gone. */
    }
  }
}

async function waitUntilFree(port, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (listPortListeners(port).length === 0) return true
    await sleep(150)
  }
  return listPortListeners(port).length === 0
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * If `port` is busy, print who holds it and either ask to kill (TTY) or exit with a kill hint.
 * @param {number|string} port
 * @param {{ interactive?: boolean }} [options]
 */
async function ensureListenPort(port, options = {}) {
  const listeners = listPortListeners(port)
  if (listeners.length === 0) return

  const killHint = killCommandForPort(port)
  console.error(`[Chaya] port ${port} is already in use:`)
  for (const item of listeners) {
    console.error(`  pid ${item.pid}: ${item.command}`)
  }
  console.error(`[Chaya] free it with: ${killHint}`)

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stderr.isTTY)
  if (!interactive) {
    console.error('[Chaya] refusing to start while the port is occupied (non-interactive).')
    process.exit(1)
  }

  const answer = await ask('[Chaya] kill the process above and continue? [y/N] ')
  if (!/^y(es)?$/i.test(String(answer || '').trim())) {
    console.error('[Chaya] aborted. Stop the other process, or re-run and confirm kill.')
    process.exit(1)
  }

  killListeners(listeners, 'SIGTERM')
  if (!(await waitUntilFree(port))) {
    killListeners(listPortListeners(port), 'SIGKILL')
    if (!(await waitUntilFree(port, 2000))) {
      console.error(`[Chaya] port ${port} is still busy after kill. Try: ${killHint}`)
      process.exit(1)
    }
  }
  console.error(`[Chaya] port ${port} is free — starting.`)
}

module.exports = {
  ensureListenPort,
  killCommandForPort,
  killListeners,
  listPortListeners,
  parseLsofListeners,
}
