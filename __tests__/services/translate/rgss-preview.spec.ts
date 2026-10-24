jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { gameContentPath } from '@/lib/game/content-files'
import { describeRgssPreview, setRgssPreviewView } from '@/services/translate/rgss-preview'

function makeRgssRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-rgss-preview-'))
  fs.mkdirSync(path.join(root, 'Data'))
  fs.writeFileSync(path.join(root, 'Data', 'System.rvdata2'), Buffer.from([4, 8, 0]))
  return root
}

describe('rgss preview (seed switch)', () => {
  it('only writes translation-preview.json and never mutates Data', () => {
    const root = makeRgssRoot()
    try {
      const dataFile = path.join(root, 'Data', 'System.rvdata2')
      const before = fs.readFileSync(dataFile)
      expect(describeRgssPreview(root)).toMatchObject({ isRgss: true, view: 'translated' })

      expect(setRgssPreviewView(root, 'original')).toEqual({ view: 'original' })
      expect(describeRgssPreview(root).view).toBe('original')
      expect(fs.readFileSync(dataFile)).toEqual(before)
      expect(JSON.parse(fs.readFileSync(gameContentPath(root, 'translationPreview'), 'utf8'))).toEqual({ view: 'original' })

      expect(setRgssPreviewView(root, 'translated')).toEqual({ view: 'translated' })
      expect(fs.readFileSync(dataFile)).toEqual(before)
      expect(JSON.parse(fs.readFileSync(gameContentPath(root, 'translationPreview'), 'utf8'))).toEqual({ view: 'translated' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
