import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { PLUGINS_DIR, PLUGINS_MANIFEST_PATH, ROOT_PATH } from '@/constants/paths'
import { DIGEST_PLUGIN_NAMES } from '@/lib/game/plugin-digest'
import { detectPluginsOutdated, kitPluginDigests } from '@/services/game/plugins'

const distRel = path.join('plugins', 'dist-outdated-spec')
const distDir = path.join(ROOT_PATH, distRel)

describe('detectPluginsOutdated', () => {
  let root: string
  let pluginsDir: string

  beforeAll(() => {
    fs.mkdirSync(distDir, { recursive: true })
    for (const name of DIGEST_PLUGIN_NAMES) fs.writeFileSync(path.join(distDir, `${name}.js`), `/* ${name} v2 */\n`)
    fs.mkdirSync(PLUGINS_DIR, { recursive: true })
    const plugins = DIGEST_PLUGIN_NAMES.map((name) => ({ name, source: path.join(distRel, `${name}.js`) }))
    fs.writeFileSync(PLUGINS_MANIFEST_PATH, JSON.stringify({ plugins }))
  })

  afterAll(() => {
    fs.rmSync(distDir, { recursive: true, force: true })
    fs.rmSync(PLUGINS_MANIFEST_PATH, { force: true })
  })

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-outdated-'))
    pluginsDir = path.join(root, 'js', 'plugins')
    fs.mkdirSync(pluginsDir, { recursive: true })
    for (const name of DIGEST_PLUGIN_NAMES) fs.copyFileSync(path.join(distDir, `${name}.js`), path.join(pluginsDir, `${name}.js`))
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('digests every build file', () => {
    expect(Object.keys(kitPluginDigests() || {}).sort()).toEqual([...DIGEST_PLUGIN_NAMES].sort())
  })

  it('is false right after copying the current build', () => {
    expect(detectPluginsOutdated(root)).toBe(false)
  })

  it('is true when an installed plugin differs from the build', () => {
    fs.writeFileSync(path.join(pluginsDir, `${DIGEST_PLUGIN_NAMES[1]}.js`), '/* v1 */\n')
    expect(detectPluginsOutdated(root)).toBe(true)
  })

  it('is true when an installed plugin is missing', () => {
    fs.rmSync(path.join(pluginsDir, `${DIGEST_PLUGIN_NAMES[0]}.js`))
    expect(detectPluginsOutdated(root)).toBe(true)
  })
})
