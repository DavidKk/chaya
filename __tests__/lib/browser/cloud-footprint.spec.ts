import { Blob } from 'node:buffer'

import { PLUGIN_LOADER_NAME } from '@/constants/brand'
import { collectCloudFingerprint } from '@/lib/browser/cloud-fingerprint'
import { countCloudCacheEntries, detectCloudPlugins, measureCloudDirBytes, measureCloudFootprint } from '@/lib/browser/cloud-footprint'
import { countReadyPlugins } from '@/lib/game/plugins-status'
import { TRACKED_PLUGINS } from '@/lib/game/types'

type Tree = { [name: string]: string | Tree }

function fakeDir(name: string, tree: Tree): FileSystemDirectoryHandle {
  const child = (key: string, kind: 'file' | 'directory') => {
    const node = tree[key]
    if (node === undefined || (typeof node === 'string') !== (kind === 'file')) throw new DOMException('missing', 'NotFoundError')
    return node
  }
  const fileHandle = (key: string, text: string) => ({ kind: 'file', name: key, getFile: async () => new Blob([text]) })
  return {
    kind: 'directory',
    name,
    async getFileHandle(key: string) {
      return fileHandle(key, child(key, 'file') as string)
    },
    async getDirectoryHandle(key: string) {
      return fakeDir(key, child(key, 'directory') as Tree)
    },
    async *values() {
      for (const [key, node] of Object.entries(tree)) yield typeof node === 'string' ? fileHandle(key, node) : fakeDir(key, node)
    },
  } as unknown as FileSystemDirectoryHandle
}

const pluginsJs = (names: Array<[string, boolean]>) => `var $plugins =\n${JSON.stringify(names.map(([name, status]) => ({ name, status, description: '', parameters: {} })))};\n`

describe('cloud footprint (FSA)', () => {
  it('sums file sizes recursively', async () => {
    expect(await measureCloudDirBytes(fakeDir('www', { 'a.txt': '1234', img: { 'b.png': '12', deep: { 'c.bin': '123' } } }))).toBe(9)
  })

  it('measures content and the shell next to it', async () => {
    const content = { 'index.html': '12345' }
    const picked = fakeDir('game', { www: content, 'Chaya.app': { Contents: { bin: '1234567890' } } })
    expect(await measureCloudFootprint(picked, fakeDir('www', content), 'Chaya.app')).toEqual({ contentBytes: 5, shellBytes: 10 })
    expect(await measureCloudFootprint(picked, fakeDir('www', content))).toEqual({ contentBytes: 5, shellBytes: null })
  })

  it('treats every tracked plugin as ready once the loader is registered', async () => {
    const content = fakeDir('www', { js: { 'plugins.js': pluginsJs([[PLUGIN_LOADER_NAME, true]]), plugins: { [`${PLUGIN_LOADER_NAME}.js`]: '' } } })
    const plugins = await detectCloudPlugins(content)
    expect(plugins.map((p) => p.name)).toEqual([...TRACKED_PLUGINS])
    expect(countReadyPlugins(plugins)).toBe(TRACKED_PLUGINS.length)
  })

  it('counts individually registered plugins without the loader', async () => {
    const [first, second] = TRACKED_PLUGINS
    const content = fakeDir('www', {
      js: {
        'plugins.js': pluginsJs([
          [PLUGIN_LOADER_NAME, false],
          [first, true],
          [second, true],
        ]),
        plugins: { [`${PLUGIN_LOADER_NAME}.js`]: '', [`${first}.js`]: '' },
      },
    })
    const plugins = await detectCloudPlugins(content)
    expect(countReadyPlugins(plugins)).toBe(1)
    expect(plugins.find((p) => p.name === second)).toMatchObject({ registered: true, fileExists: false })
    expect(countReadyPlugins(await detectCloudPlugins(fakeDir('www', {})))).toBe(0)
  })

  it('summarizes the fingerprint like the server (third-party plugins only, encryption)', async () => {
    const content = fakeDir('www', {
      js: {
        'plugins.js': pluginsJs([
          [PLUGIN_LOADER_NAME, true],
          ['YEP_CoreEngine', true],
          ['YEP_MessageCore', false],
        ]),
        plugins: {},
      },
      data: { 'System.json': JSON.stringify({ hasEncryptedImages: true }) },
    })
    expect(await collectCloudFingerprint(content)).toMatchObject({ pluginCount: 2, enabledPluginCount: 1, encrypted: true })
  })

  it('counts non-empty cache lines, falling back to the parent directory', async () => {
    const lines = '{"a":1}\n\n{"b":2}\n{"c":3}'
    const inContent = { chaya: { translate: { 'cache.ndjson': lines } } }
    expect(await countCloudCacheEntries(fakeDir('www', inContent), fakeDir('www', inContent))).toBe(3)
    const content = fakeDir('www', {})
    expect(await countCloudCacheEntries(fakeDir('game', { www: {}, 'translate-both.cache.ndjson': lines }), content)).toBe(3)
    expect(await countCloudCacheEntries(fakeDir('game', { www: {} }), content)).toBe(0)
  })
})
