import { DIGEST_PLUGIN_NAMES, pluginDigest, pluginsOutdated } from '@/lib/game/plugin-digest'

describe('pluginDigest', () => {
  it('is stable and content-sensitive', () => {
    expect(pluginDigest('abc')).toBe(pluginDigest('abc'))
    expect(pluginDigest('abc')).not.toBe(pluginDigest('abd'))
    expect(pluginDigest('')).toMatch(/^0-/)
  })
})

describe('pluginsOutdated', () => {
  const latest = Object.fromEntries(DIGEST_PLUGIN_NAMES.map((name) => [name, pluginDigest(name)]))

  it('is false when every file matches', () => {
    expect(pluginsOutdated({ ...latest }, latest)).toBe(false)
  })

  it('is true when a file differs or is missing', () => {
    const [first, second] = DIGEST_PLUGIN_NAMES
    expect(pluginsOutdated({ ...latest, [first]: pluginDigest('old') }, latest)).toBe(true)
    expect(pluginsOutdated({ ...latest, [second]: null }, latest)).toBe(true)
  })

  it('is false when the latest build is unknown', () => {
    expect(pluginsOutdated({}, null)).toBe(false)
    expect(pluginsOutdated({}, {})).toBe(false)
  })
})
