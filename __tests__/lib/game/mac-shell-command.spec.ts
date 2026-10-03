import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MAC_SHELL_SCRIPT } from '@/lib/game/mac-shell-command'
import { MAC_SHELL_MESSAGES } from '@/lib/game/mac-shell-messages'

let root: string
let game: string
let bin: string
function stub(name: string, body: string) {
  fs.writeFileSync(path.join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 })
}
function execute(extra: Record<string, string> = {}) {
  return spawnSync('/bin/bash', {
    input: MAC_SHELL_SCRIPT,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, TEST_GAME: game, CHAYA_NW_CACHE_DIR: path.join(root, 'cache'), CHAYA_LANG: 'en', ...extra },
  })
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
  // Real versions.json is thousands of lines; readers that exit early must not break the pipeline.
  const older = Array.from({ length: 3000 }, (_, i) => ({ version: `v0.${i}.0`, components: { chromium: `${i}.0.0.0` } }))
  const versions = { latest: 'v0.116.0', stable: 'v0.116.0', versions: [{ version: 'v0.116.0', components: { chromium: '153.0.8010.12' } }, ...older] }
  fs.writeFileSync(path.join(root, 'versions.json'), JSON.stringify(versions, null, 4))
  fs.mkdirSync(path.join(root, 'i18n'))
  for (const [locale, messages] of Object.entries(MAC_SHELL_MESSAGES)) fs.writeFileSync(path.join(root, 'i18n', `mac-shell.${locale}.json`), JSON.stringify(messages))
  stub(
    'curl',
    'for arg; do case "$arg" in *versions.json*) cat "$TEST_GAME/../versions.json"; exit 0;; esac; done\n' +
      'for arg; do case "$arg" in */sh/i18n/*) [ -z "${TEST_NO_I18N:-}" ] || exit 22; f=$(basename "$arg"); prev=; for a; do [ "$prev" = -o ] && cp "$TEST_GAME/../i18n/$f" "$a"; prev="$a"; done; exit 0;; esac; done\n' +
      'out=; prev=\nfor arg; do case "$arg" in *SHASUMS256.txt) exit 22;; esac; if [ "$prev" = -o ]; then out="$arg"; fi; prev="$arg"; done\nif [ "${TEST_FAIL:-}" = download ]; then exit 22; fi\necho "$*" >> "$TEST_GAME/../downloads"\nprintf zip >> "$out"\nif [ "${TEST_FAIL:-}" = interrupt ]; then exit 18; fi'
  )
  stub('unzip', '[ "${TEST_FAIL:-}" != interrupt ] && [ "${TEST_FAIL:-}" != corrupt ]')
  // JSON language packs are read with a Node stand-in (CI has no plutil); Info.plist reads return TEST_CHROMIUM.
  stub(
    'plutil',
    `case "$6" in */Info.plist) [ -n "\${TEST_CHROMIUM:-}" ] && printf "%s" "$TEST_CHROMIUM"; exit;; esac
exec "${process.execPath}" -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (typeof v !== "string") process.exit(1); process.stdout.write(v)' "$6" "$2"`
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
test.each([
  [{ CHAYA_LANG: 'zh' }, '安装完成'],
  [{ CHAYA_LANG: '', LC_ALL: '', LC_MESSAGES: '', LANG: 'ja_JP.UTF-8' }, 'インストール完了'],
  [{ CHAYA_LANG: '', LC_ALL: '', LC_MESSAGES: '', LANG: 'ko_KR.UTF-8' }, '설치 완료'],
  [{ CHAYA_LANG: 'fr' }, 'Installed'],
  [{ CHAYA_LANG: 'zh', TEST_NO_I18N: '1' }, 'Installed'],
])('picks the message language (%o)', (env, installed) => {
  const result = execute(env)
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(installed)
})
test('a language pack value with quotes is ignored', () => {
  const pack = { ...MAC_SHELL_MESSAGES.zh, installed: 'x" & do shell script "touch PWNED' }
  fs.writeFileSync(path.join(root, 'i18n', 'mac-shell.zh.json'), JSON.stringify(pack))
  const result = execute({ CHAYA_LANG: 'zh' })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('✓ Installed')
  expect(result.stdout).toContain('游戏壳：')
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
function downloads() {
  const file = path.join(root, 'downloads')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').length : 0
}
function backups() {
  return fs.readdirSync(game).filter((name) => name.startsWith('Chaya.app.backup-')).length
}
test.each([
  ['up to date', '153.0.8010.12', 'skipping download'],
  ['newer', '160.0.0.1', 'skipping download'],
  ['older without confirmation', '152.0.1.1', 'outdated'],
  ['unknown version without confirmation', '', 'Cannot determine'],
])('intact existing shell (%s) is kept without downloading', (_case, chromium, message) => {
  expect(execute().status).toBe(0)
  expect(downloads()).toBe(1)
  const result = execute({ TEST_CHROMIUM: chromium })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(message)
  expect(result.stdout).toContain('Kept the existing shell')
  expect(downloads()).toBe(1)
  expect(backups()).toBe(1)
})
describe('download cache', () => {
  const zipName = 'nwjs-v0.116.0-osx-arm64.zip'
  const cached = () => path.join(root, 'cache', zipName)

  test('a verified download is reused by the next run', () => {
    expect(execute({ TEST_FAIL: 'sign' }).status).not.toBe(0)
    expect(fs.existsSync(cached())).toBe(true)
    const result = execute()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Using cached download')
    expect(downloads()).toBe(1)
    expect((fs.statSync(path.join(root, 'cache')).mode & 0o777).toString(8)).toBe('700')
  })

  test('an unfinished .part is resumed', () => {
    fs.mkdirSync(path.join(root, 'cache'), { mode: 0o700 })
    fs.writeFileSync(`${cached()}.part`, 'half')
    const result = execute()
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Resuming the previous download')
    expect(fs.readFileSync(path.join(root, 'downloads'), 'utf8')).toContain('--continue-at -')
    expect(fs.readFileSync(cached(), 'utf8')).toBe('halfzip')
    expect(fs.existsSync(`${cached()}.part`)).toBe(false)
  })

  test('an interrupted download keeps its progress', () => {
    const result = execute({ TEST_FAIL: 'interrupt' })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('progress kept')
    expect(fs.existsSync(`${cached()}.part`)).toBe(true)
    expect(fs.readFileSync(path.join(game, 'Chaya.app/original'), 'utf8')).toBe('old-shell')
  })

  test('a complete but corrupt download is discarded', () => {
    const result = execute({ TEST_FAIL: 'corrupt' })
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain('checksum failed')
    expect(fs.existsSync(`${cached()}.part`)).toBe(false)
  })

  test('a cache path that is a symlink is not trusted', () => {
    const elsewhere = path.join(root, 'elsewhere')
    fs.mkdirSync(elsewhere)
    fs.symlinkSync(elsewhere, path.join(root, 'cache'))
    expect(execute().status).toBe(0)
    expect(fs.readdirSync(elsewhere)).toEqual([])
  })
})
test.each(['download', 'sign', 'replace'])('%s failure preserves or restores original shell', (failure) => {
  const result = execute({ TEST_FAIL: failure })
  expect(result.status).not.toBe(0)
  expect(fs.readFileSync(path.join(game, 'Chaya.app/original'), 'utf8')).toBe('old-shell')
  expect(fs.readFileSync(path.join(game, 'www/save.rpgsave'), 'utf8')).toBe('save')
  expect(fs.readdirSync(game).some((name) => name.startsWith('.chaya-install.'))).toBe(false)
})
