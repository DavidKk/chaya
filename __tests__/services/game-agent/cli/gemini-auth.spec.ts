import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ANTIGRAVITY_SETTINGS_PATH, ANTIGRAVITY_TOKEN_PATH } from '@/services/game-agent/cli/antigravity.server'
import { createGeminiAuthAdapter, extractAntigravityLoginUrl } from '@/services/game-agent/cli/auth/gemini-antigravity.server'
import type { PtyProcess } from '@/services/game-agent/cli/pty.server'

const LOGIN_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&state=abc&scope=openid'

function fakePty() {
  const listeners = new Set<(chunk: string) => void>()
  const writes: string[] = []
  let exit: (code: number) => void = () => undefined
  const exited = new Promise<number>((resolve) => (exit = resolve))
  let killed = 0
  const pty: PtyProcess = {
    write: (data) => writes.push(data),
    onData: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    exited,
    kill: () => {
      killed += 1
      exit(143)
    },
  }
  return {
    pty,
    writes,
    emit: (chunk: string) => listeners.forEach((listener) => listener(chunk)),
    exit: (code: number) => exit(code),
    killed: () => killed,
  }
}

let stagingDir: string

beforeEach(() => {
  stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-gemini-auth-'))
})

afterEach(() => {
  fs.rmSync(stagingDir, { recursive: true, force: true })
})

function setup(verify = jest.fn(async () => [])) {
  const term = fakePty()
  const spawn = jest.fn(async () => term.pty)
  const adapter = createGeminiAuthAdapter({ resolveFile: async () => '/opt/agy/agy', spawn, verify, pollMs: 5 })
  return { term, spawn, verify, adapter }
}

async function startWithUrl(adapter: ReturnType<typeof setup>['adapter'], term: ReturnType<typeof fakePty>, signal = new AbortController().signal) {
  const started = adapter.start({ stagingDir, signal, env: { HTTPS_PROXY: 'http://127.0.0.1:7890' } })
  await new Promise((resolve) => setImmediate(resolve))
  term.emit('\u001b[1mSelect login method:\u001b[0m\r\n> Google\r\n')
  term.emit(`Open this URL:\r\n\u001b[4m${LOGIN_URL}\u001b[0m\r\nEnter code: `)
  return started
}

test('extracts only a complete Google consent link that returns to Antigravity', () => {
  expect(extractAntigravityLoginUrl(`\u001b[4m${LOGIN_URL}\u001b[0m\r\n`)).toBe(LOGIN_URL)
  expect(extractAntigravityLoginUrl(LOGIN_URL)).toBeNull()
  expect(extractAntigravityLoginUrl(`${LOGIN_URL.replace('antigravity.google', 'evil.example')}\n`)).toBeNull()
  expect(extractAntigravityLoginUrl(`${LOGIN_URL.replace('response_type=code', 'response_type=token')}\n`)).toBeNull()
})

test('runs agy in an isolated home, picks Google login and returns a paste-back challenge', async () => {
  const { term, spawn, adapter } = setup()
  const handle = await startWithUrl(adapter, term)

  expect(handle.challenge).toMatchObject({ kind: 'callback_code', url: LOGIN_URL })
  const [file, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }]
  expect(file).toBe('/opt/agy/agy')
  expect(args).toEqual([])
  expect(options.cwd).toBe(stagingDir)
  expect(options.env).toMatchObject({ HOME: stagingDir, USERPROFILE: stagingDir, NO_BROWSER: 'true', HTTPS_PROXY: 'http://127.0.0.1:7890', AGY_CLI_DISABLE_AUTO_UPDATE: 'true' })
  expect(options.env.SSH_CONNECTION).toBeTruthy()
  expect(term.writes).toContain('\r')
  expect(fs.existsSync(path.join(stagingDir, ANTIGRAVITY_SETTINGS_PATH))).toBe(true)
  await handle.cancel()
  await expect(handle.completed).rejects.toBeTruthy()
})

test('answers terminal device queries agy sends before drawing', async () => {
  const { term, adapter } = setup()
  const started = adapter.start({ stagingDir, signal: new AbortController().signal, env: {} })
  await new Promise((resolve) => setImmediate(resolve))
  term.emit('\u001b[>c\u001b[6n')
  expect(term.writes).toEqual(expect.arrayContaining(['\u001b[>0;1;0c', '\u001b[1;1R']))
  term.exit(1)
  await expect(started).rejects.toMatchObject({ code: 'AGENT_CLI_CRASHED' })
})

test('writes the pasted code back and completes once the token file exists and models load', async () => {
  const { term, verify, adapter } = setup()
  const handle = await startWithUrl(adapter, term)

  await handle.submitCode!('4/0AVG-code_123')
  expect(term.writes.at(-1)).toBe('4/0AVG-code_123\r')
  const token = path.join(stagingDir, ANTIGRAVITY_TOKEN_PATH)
  fs.mkdirSync(path.dirname(token), { recursive: true })
  fs.writeFileSync(token, '{"refresh_token":"r"}')

  await expect(handle.completed).resolves.toEqual({ account: { plan: 'Google' } })
  expect(verify).toHaveBeenCalledWith('/opt/agy/agy', expect.objectContaining({ HOME: stagingDir }), expect.any(AbortSignal))
  expect(term.killed()).toBeGreaterThan(0)
})

test('rejects pasted codes that could steer the terminal', async () => {
  const { term, adapter } = setup()
  const handle = await startWithUrl(adapter, term)
  await expect(handle.submitCode!('abc\u001b[2J')).rejects.toMatchObject({ code: 'AGENT_AUTH_FAILED' })
  await expect(handle.submitCode!('abc def')).rejects.toMatchObject({ code: 'AGENT_AUTH_FAILED' })
  expect(term.writes.some((value) => value.includes('abc'))).toBe(false)
  await handle.cancel()
  await expect(handle.completed).rejects.toBeTruthy()
})

test('fails when agy exits after the code without writing a token', async () => {
  const { term, adapter } = setup()
  const handle = await startWithUrl(adapter, term)
  await handle.submitCode!('bad-code')
  term.exit(1)
  await expect(handle.completed).rejects.toMatchObject({ code: 'AGENT_AUTH_FAILED' })
})

test('reports a token that cannot list models as a failed authorization', async () => {
  const { term, adapter } = setup(
    jest.fn(async () => {
      throw new Error('PERMISSION_DENIED')
    })
  )
  const handle = await startWithUrl(adapter, term)
  const token = path.join(stagingDir, ANTIGRAVITY_TOKEN_PATH)
  fs.mkdirSync(path.dirname(token), { recursive: true })
  fs.writeFileSync(token, '{}')
  await expect(handle.completed).rejects.toMatchObject({ code: 'AGENT_AUTH_FAILED', message: expect.stringContaining('PERMISSION_DENIED') })
})

test('aborting the attempt stops agy', async () => {
  const { term, adapter } = setup()
  const abort = new AbortController()
  const handle = await startWithUrl(adapter, term, abort.signal)
  abort.abort()
  expect(term.killed()).toBeGreaterThan(0)
  await expect(handle.completed).rejects.toBeTruthy()
})
