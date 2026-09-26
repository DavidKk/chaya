import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentRelPath } from '@/lib/game/content-paths'
import { loadGameTranslateLookup } from '@/services/translate/game-lookup'

it('applies deletion rows after seed and earlier library translations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-game-lookup-'))
  try {
    const seedFile = path.join(root, gameContentRelPath('seed'))
    const libraryFile = path.join(root, gameContentRelPath('cacheNdjson'))
    fs.mkdirSync(path.dirname(seedFile), { recursive: true })
    fs.writeFileSync(seedFile, JSON.stringify({ こんにちは: '你好', さようなら: '再见' }))
    fs.writeFileSync(libraryFile, [JSON.stringify(['こんにちは', '您好']), JSON.stringify({ s: 'こんにちは', t: null }), JSON.stringify(['さようなら', null])].join('\n'))
    const lookup = loadGameTranslateLookup(root)
    expect(lookup['こんにちは']).toBeUndefined()
    expect(lookup['さようなら']).toBeUndefined()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
