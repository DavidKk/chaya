import { spawnSync } from 'node:child_process'

import { REMOTE_SCRIPT_NAMES, remoteScriptCommand } from '@/lib/remote-scripts/command'
import { getRemoteScriptSource, getScriptI18nPack, SCRIPT_MESSAGES } from '@/lib/remote-scripts/registry'

test.each(REMOTE_SCRIPT_NAMES)('%s is valid Bash', (name) => {
  const source = getRemoteScriptSource(name)
  expect(source).toMatch(/^#!\/usr\/bin\/env bash\n/)
  expect(spawnSync('/bin/bash', ['-n'], { input: source! }).status).toBe(0)
})

test('unknown names are not served', () => {
  expect(getRemoteScriptSource('../package.json')).toBeNull()
})

test('one-liner fetches from the page origin', () => {
  expect(remoteScriptCommand('http://127.0.0.1:3927/', 'mac-shell.sh')).toBe('/bin/bash -c "$(curl -fsSL http://127.0.0.1:3927/sh/mac-shell.sh)"')
})

test('localized scripts receive the page locale', () => {
  expect(remoteScriptCommand('http://x', 'mac-shell.sh', 'zh')).toBe('CHAYA_LANG=zh /bin/bash -c "$(curl -fsSL http://x/sh/mac-shell.sh)"')
  expect(remoteScriptCommand('http://x', 'install.sh', 'zh')).toBe('CHAYA_LANG=zh /bin/bash -c "$(curl -fsSL http://x/sh/install.sh)"')
  expect(remoteScriptCommand('http://x', 'install.sh')).toBe('/bin/bash -c "$(curl -fsSL http://x/sh/install.sh)"')
})

test('the serving origin is filled in only when it is a plain URL origin', () => {
  expect(getRemoteScriptSource('mac-shell.sh', 'http://127.0.0.1:3927/')).toContain("'http://127.0.0.1:3927/sh/i18n/mac-shell.'")
  expect(getRemoteScriptSource('mac-shell.sh', "http://evil'$(id)")).toContain('__CHAYA_ORIGIN__')
})

test('language packs are served per script and locale', () => {
  expect(getScriptI18nPack('install.zh.json')?.done).toBe(SCRIPT_MESSAGES.install.zh.done)
  expect(getScriptI18nPack('mac-shell.ja.json')?.installed).toBe(SCRIPT_MESSAGES['mac-shell'].ja.installed)
  expect(getScriptI18nPack('install.fr.json')).toBeNull()
  expect(getScriptI18nPack('../package.json')).toBeNull()
})

test.each(Object.entries(SCRIPT_MESSAGES))('%s: every locale has the same keys and safe values', (_script, messages) => {
  const english = messages.en
  for (const pack of Object.values(messages)) {
    expect(Object.keys(pack).sort()).toEqual(Object.keys(english).sort())
    for (const [key, value] of Object.entries(pack)) {
      expect(value).not.toMatch(/["\\`]|\$\{|%(?!s)/)
      expect(value.split('%s').length).toBe(english[key].split('%s').length)
    }
  }
})
