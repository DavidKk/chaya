#!/usr/bin/env node
/**
 * Wrap `next dev|start`: mint the management token / auth link, and rewrite listen logs to
 *   Local:   http://127.0.0.1:PORT
 *   Network: http://<lan-ip>:PORT
 * (Next defaults Local to localhost and Network to 0.0.0.0.)
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import localAccess from './local-access.cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')

function detectLanIpv4() {
  const candidates = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const v4 = a.family === 'IPv4' || a.family === 4
      if (v4 && !a.internal) candidates.push({ name, address: a.address })
    }
  }
  const score = (c) => {
    let s = 0
    if (/^en\d+$/i.test(c.name) || /^eth\d+$/i.test(c.name) || /^wlan/i.test(c.name) || /^wi-?fi/i.test(c.name)) s += 100
    if (/^192\.168\./.test(c.address)) s += 50
    else if (/^10\./.test(c.address)) s += 40
    else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(c.address)) s += 30
    if (/^(bridge|feth|veth|docker|vmnet|vbox|utun)/i.test(c.name)) s -= 80
    return s
  }
  candidates.sort((a, b) => score(b) - score(a))
  return candidates[0]?.address || null
}

function rewriteListenLine(line, lanIp) {
  // Next: `- Local:         http://localhost:3927`
  let out = line.replace(/(- Local:\s+)https?:\/\/localhost(:\d+)/, '$1http://127.0.0.1$2')
  out = out.replace(/(- Local:\s+)https?:\/\/127\.0\.0\.1(:\d+)/, '$1http://127.0.0.1$2')
  // Next: `- Network:       http://0.0.0.0:3927` (when -H 0.0.0.0)
  if (lanIp) {
    out = out.replace(/(- Network:\s+)https?:\/\/(?:0\.0\.0\.0|\[::\])(:\d+)/, `$1http://${lanIp}$2`)
  }
  return out
}

function pipeRewrite(stream, write, lanIp) {
  let buf = ''
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf8')
    const parts = buf.split(/\r?\n/)
    buf = parts.pop() ?? ''
    for (const line of parts) {
      write(rewriteListenLine(line, lanIp) + '\n')
    }
  })
  stream.on('end', () => {
    if (buf) write(rewriteListenLine(buf, lanIp))
  })
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('usage: node scripts/next-listen.mjs <dev|start> [...next args]')
  process.exit(1)
}

const lanIp = detectLanIpv4()
if (process.env.CHAYA_SERVICE !== 'vercel' && process.env.VERCEL !== '1') {
  process.env.CHAYA_AUTH_TOKEN = localAccess.ensureAccessToken()
  const portIndex = args.findIndex((a) => a === '-p' || a === '--port')
  const port = portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 3927
  const suffix = `/api/access?token=${encodeURIComponent(process.env.CHAYA_AUTH_TOKEN)}`
  console.log(`[Chaya] local auth link: http://127.0.0.1:${port}${suffix}`)
  if (args.includes('0.0.0.0') && lanIp) console.log(`[Chaya] LAN auth link: http://${lanIp}:${port}${suffix}`)
}
const child = spawn(process.execPath, [nextBin, ...args], {
  cwd: root,
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
})

pipeRewrite(child.stdout, (s) => process.stdout.write(s), lanIp)
pipeRewrite(child.stderr, (s) => process.stderr.write(s), lanIp)

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig)
  })
}
