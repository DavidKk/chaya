import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MAC_SHELL_SCRIPT } from '@/lib/game/mac-shell-command'

let root: string
let game: string
let bin: string
function stub(name: string, body: string) {
  fs.writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 })
}
function execute(extra: Record<string, string> = {}) {
  return spawnSync('/bin/bash', { input: MAC_SHELL_SCRIPT, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, TEST_GAME: game, ...extra } })
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-command-test-'))
  // Spaces, apostrophes and command substitutions must stay literal throughout the script.
  game = path.join(root, "游戏 ' $(touch UNEXPECTED) [demo]")
  bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(game, 'www', 'js'), { recursive: true })
  fs.writeFileSync(path.join(game, 'www', 'index.html'), 'game')
  fs.writeFileSync(path.join(game, 'www', 'save.rpgsave'), 'save')
  fs.mkdirSync(path.join(game, 'Chaya.app'))
  fs.writeFileSync(path.join(game, 'Chaya.app', 'original'), 'old-shell')
  stub('uname', 'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi')
  stub('osascript', 'printf "%s\\n" "$TEST_GAME"')
  stub(
    'curl',
    'for arg; do case "$arg" in *versions.json*) printf \'{"stable":"v0.116.0","latest":"v0.116.0"}\\n\'; exit 0;; esac; done\nif [ "${TEST_FAIL:-}" = download ]; then exit 22; fi\nfor last; do :; done\ntouch "$last"'
  )
  stub(
    'ditto',
    `fresh="$4/nwjs-v0.116.0-osx-arm64/nwjs.app"
mkdir -p "$fresh/Contents/MacOS" "$fresh/Contents/Resources"
printf '#!/bin/bash\\nexit 0\\n' > "$fresh/Contents/MacOS/nwjs"
chmod +x "$fresh/Contents/MacOS/nwjs"`
  )
  stub('xattr', ':')
  stub('codesign', '[ "${TEST_FAIL:-}" != sign ]')
  stub('mv', 'case "$1" in */extracted/*) if [ "${TEST_FAIL:-}" = replace ]; then exit 1; fi;; esac\nexec /bin/mv "$@"')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

test('served script is valid Bash', () => {
  expect(spawnSync('/bin/bash', ['-n'], { input: MAC_SHELL_SCRIPT }).status).toBe(0)
})
test('installs the new shell, links content and retains old shell and saves', () => {
  const result = execute()
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(fs.readlinkSync(path.join(game, 'Chaya.app/Contents/Resources/app.nw'))).toBe(fs.realpathSync(path.join(game, 'www')))
  const backup = fs.readdirSync(game).find((name) => name.startsWith('Chaya.app.backup-'))!
  expect(fs.readFileSync(path.join(game, backup, 'original'), 'utf8')).toBe('old-shell')
  expect(fs.readFileSync(path.join(game, 'www/save.rpgsave'), 'utf8')).toBe('save')
  expect(fs.readdirSync(game).some((name) => name.startsWith('.chaya-install.'))).toBe(false)
})
test.each(['download', 'sign', 'replace'])('%s failure preserves or restores original shell', (failure) => {
  const result = execute({ TEST_FAIL: failure })
  expect(result.status).not.toBe(0)
  expect(fs.readFileSync(path.join(game, 'Chaya.app/original'), 'utf8')).toBe('old-shell')
  expect(fs.readFileSync(path.join(game, 'www/save.rpgsave'), 'utf8')).toBe('save')
  expect(fs.readdirSync(game).some((name) => name.startsWith('.chaya-install.'))).toBe(false)
})
