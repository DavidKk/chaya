import { describe, expect, it } from '@jest/globals'

import { CONTENT_FILE_PREFIX } from '@/constants/brand'
import { GAME_CONTENT_DIR, gameContentRelPath, gamePluginsCacheRelDir, gamePluginsDisabledRelPath } from '@/lib/game/content-paths'

describe('content-paths', () => {
  it('品牌目录与相对路径', () => {
    expect(GAME_CONTENT_DIR).toBe(CONTENT_FILE_PREFIX)
    expect(gameContentRelPath('cacheNdjson')).toBe(`${CONTENT_FILE_PREFIX}/translate/cache.ndjson`)
    expect(gameContentRelPath('gameEdit')).toBe(`${CONTENT_FILE_PREFIX}/config/game-edit.json`)
  })

  it('插件缓存与 sticky disabled', () => {
    expect(gamePluginsCacheRelDir()).toBe(`${CONTENT_FILE_PREFIX}/plugins`)
    expect(gamePluginsDisabledRelPath()).toBe(`${CONTENT_FILE_PREFIX}/config/plugins-disabled`)
  })
})
