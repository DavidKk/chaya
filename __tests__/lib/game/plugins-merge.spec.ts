import { describe, expect, it } from '@jest/globals'

import { PLUGIN_ENV_NAME, PLUGIN_LOADER_NAME } from '@/constants/brand'
import { mergeLoaderPluginEntries } from '@/lib/game/plugins-merge'
import { TRACKED_PLUGINS } from '@/lib/game/types'

describe('mergeLoaderPluginEntries', () => {
  it('置顶 Env + Loader，并去掉 TRACKED', () => {
    const next = mergeLoaderPluginEntries(
      [
        { name: 'SomePlugin', status: true },
        { name: TRACKED_PLUGINS[0], status: true },
        { name: PLUGIN_LOADER_NAME, status: false },
      ],
      { name: PLUGIN_LOADER_NAME, status: true, description: 'loader', parameters: {} }
    )
    expect(next.map((p) => p.name)).toEqual([PLUGIN_ENV_NAME, PLUGIN_LOADER_NAME, 'SomePlugin'])
    expect(next[1]?.status).toBe(true)
  })
})
