import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { cliHomeDir, cursorIsolatedHome } from '@/services/game-agent/cli/cli-home.server'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-cli-home-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function fakeRealHome() {
  const real = path.join(tmp, 'real')
  fs.mkdirSync(path.join(real, 'Library', 'Keychains'), { recursive: true })
  fs.mkdirSync(path.join(real, '.cursor', 'skills-cursor'), { recursive: true })
  fs.writeFileSync(path.join(real, '.cursor', 'auth.json'), '{"token":"x"}')
  fs.writeFileSync(path.join(real, '.cursor', 'cli-config.json'), '{"permissions":{"allow":["Shell(*)"]}}')
  fs.mkdirSync(path.join(real, '.agents', 'skills', 'global-skill'), { recursive: true })
  return real
}

test('each CLI gets its own fixed directory under the Chaya root', () => {
  expect(cliHomeDir('codex', tmp)).toBe(path.join(tmp, 'codex'))
  expect(fs.statSync(path.join(tmp, 'codex')).mode & 0o777).toBe(0o700)
})

test('Cursor on macOS sees only the login links, the deny list and no skill pack', () => {
  const real = fakeRealHome()
  const root = path.join(tmp, 'root')
  const env = cursorIsolatedHome(root, real, {}, 'darwin')
  const home = path.join(root, 'cursor')
  expect(env).toEqual({ HOME: home, USERPROFILE: home })
  expect(fs.readlinkSync(path.join(home, 'Library', 'Keychains'))).toBe(path.join(real, 'Library', 'Keychains'))
  expect(fs.readlinkSync(path.join(home, '.cursor', 'auth.json'))).toBe(path.join(real, '.cursor', 'auth.json'))
  expect(fs.statSync(path.join(home, '.cursor', 'skills-cursor')).isFile()).toBe(true)
  expect(fs.existsSync(path.join(home, '.agents'))).toBe(false)
  const config = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'cli-config.json'), 'utf8'))
  expect(config.permissions).toEqual({ allow: [], deny: ['Shell(*)', 'Read(**)', 'Write(**)', 'WebFetch(*)', 'Mcp(*:*)'] })
  expect(JSON.parse(fs.readFileSync(path.join(real, '.cursor', 'cli-config.json'), 'utf8')).permissions.allow).toEqual(['Shell(*)'])

  fs.rmSync(path.join(home, '.cursor', 'auth.json'))
  fs.symlinkSync(path.join(tmp, 'missing'), path.join(home, '.cursor', 'auth.json'))
  expect(() => cursorIsolatedHome(root, real, {}, 'darwin')).not.toThrow()
})

test('Cursor on Linux links auth.json from the real XDG config dir', () => {
  const real = fakeRealHome()
  const xdg = path.join(tmp, 'xdg')
  fs.mkdirSync(path.join(xdg, 'cursor'), { recursive: true })
  fs.writeFileSync(path.join(xdg, 'cursor', 'auth.json'), '{}')
  const root = path.join(tmp, 'root')
  const env = cursorIsolatedHome(root, real, { XDG_CONFIG_HOME: xdg }, 'linux')
  const home = path.join(root, 'cursor')
  expect(env).toEqual({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') })
  expect(fs.readlinkSync(path.join(home, '.config', 'cursor', 'auth.json'))).toBe(path.join(xdg, 'cursor', 'auth.json'))
})
