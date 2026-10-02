import { spawnSync } from 'node:child_process'

import { REMOTE_SCRIPT_NAMES, remoteScriptCommand } from '@/lib/remote-scripts/command'
import { getRemoteScriptSource } from '@/lib/remote-scripts/registry'

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
