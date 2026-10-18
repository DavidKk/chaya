import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import { ensureGameContentDir } from '@/lib/game/content-files'
import { loadExtractedItems } from '@/services/extract/lib/extract-items'
import { loadExtractedItemsWithLocales } from '@/services/extract/lib/extract-items'
import { extractParallelCorpus, findLocalesDirectory, loadGameLocalesCatalog } from '@/services/extract/lib/game-locales'
import { resetExtractedItem, saveExtractedItem } from '@/services/extract/lib/save-items'
import { saveLocalesItem } from '@/services/extract/lib/save-locales-item'

describe('extract-items and save-items', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-extract-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads extracted items with correct categories and speakers', () => {
    const extractStrings = {
      dialogue: [
        {
          lines: ['Hello, traveler!'],
          face: 'Elder',
          map: 1,
          kind: 'd',
        },
      ],
      db: {
        items: [{ name: 'Potion', description: 'Restores 50 HP.' }],
      },
    }

    const seed = {
      'Hello, traveler!': '你好，旅人！',
    }

    const extractFile = ensureGameContentDir(tmpDir, 'extractStrings')
    const seedFile = ensureGameContentDir(tmpDir, 'seed')

    fs.writeFileSync(extractFile, JSON.stringify(extractStrings))
    fs.writeFileSync(seedFile, JSON.stringify(seed))

    const items = loadExtractedItems(tmpDir)
    expect(items.length).toBeGreaterThanOrEqual(3)

    const dialogueItem = items.find((i) => i.src === 'Hello, traveler!')
    expect(dialogueItem).toBeDefined()
    expect(dialogueItem?.meta.category).toBe('dialogue')
    expect(dialogueItem?.meta.speaker).toBe('Elder')
    expect(dialogueItem?.meta.context).toBe('地图 1')
    expect(dialogueItem?.meta.file).toBe('data/Map001.json')
    expect(dialogueItem?.zh).toBe('你好，旅人！')
    expect(dialogueItem?.savedZh).toBe('你好，旅人！')

    const potionItem = items.find((i) => i.src === 'Potion')
    expect(potionItem).toBeDefined()
    expect(potionItem?.meta.category).toBe('item')
    expect(potionItem?.meta.file).toBe('data/Items.json')

    const potionDesc = items.find((i) => i.src === 'Restores 50 HP.')
    expect(potionDesc).toBeDefined()
    expect(potionDesc?.meta.category).toBe('item_desc')
    expect(potionDesc?.meta.file).toBe('data/Items.json')
  })

  it('correctly distinguishes system prompts, story narration, and dialogue speakers', () => {
    const extractStrings = {
      dialogue: [
        {
          lines: ['+ {Thief dagger}'],
          ev: 'EV003',
          eid: 3,
          map: 1,
          kind: 'd',
        },
        {
          lines: ['A cold breeze blows through the cavern.'],
          ev: 'EV004',
          eid: 4,
          map: 1,
          kind: 'd',
        },
        {
          lines: ['We must move forward.'],
          face: '1Diana',
          ev: 'EV010',
          eid: 10,
          map: 1,
          kind: 'd',
        },
      ],
    }

    const extractFile = ensureGameContentDir(tmpDir, 'extractStrings')
    fs.writeFileSync(extractFile, JSON.stringify(extractStrings))

    const items = loadExtractedItems(tmpDir)

    // 1. System prompt (+ {item}): category = system, no speaker
    const sysItem = items.find((i) => i.src === '+ {Thief dagger}')
    expect(sysItem).toBeDefined()
    expect(sysItem?.meta.category).toBe('system')
    expect(sysItem?.meta.speaker).toBeUndefined()

    // 2. Story / narration without face: category = story, no speaker
    const storyItem = items.find((i) => i.src === 'A cold breeze blows through the cavern.')
    expect(storyItem).toBeDefined()
    expect(storyItem?.meta.category).toBe('story')
    expect(storyItem?.meta.label).toBe('剧情/旁白')
    expect(storyItem?.meta.speaker).toBeUndefined()

    // 3. Dialogue with face: category = dialogue, speaker = Diana (cleaned from 1Diana)
    const dianaItem = items.find((i) => i.src === 'We must move forward.')
    expect(dianaItem).toBeDefined()
    expect(dianaItem?.meta.category).toBe('dialogue')
    expect(dianaItem?.meta.speaker).toBe('Diana')
  })

  it('saves and resets extracted item in seed.json and cache.ndjson', () => {
    const seed = {
      Hello: '旧翻译',
    }
    const seedFile = ensureGameContentDir(tmpDir, 'seed')
    fs.writeFileSync(seedFile, JSON.stringify(seed))

    // Save
    const saveRes = saveExtractedItem(tmpDir, 'Hello', '新翻译')
    expect(saveRes.ok).toBe(true)

    const updatedSeed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
    expect(updatedSeed['Hello']).toBe('新翻译')

    // Reset
    const resetRes = resetExtractedItem(tmpDir, 'Hello')
    expect(resetRes.ok).toBe(true)

    const resetSeed = JSON.parse(fs.readFileSync(seedFile, 'utf8'))
    expect(resetSeed['Hello']).toBe('')

    const cacheFile = ensureGameContentDir(tmpDir, 'cacheNdjson')
    const ndjsonContent = fs.readFileSync(cacheFile, 'utf8')
    expect(ndjsonContent).toContain('"engine":"reset"')
  })

  it('detects locales directory, ignores Chromium .pak files, and loads multi-language text', () => {
    // Simulate NW.js root with system locales/*.pak
    const sysLocales = path.join(tmpDir, 'locales')
    fs.mkdirSync(sysLocales, { recursive: true })
    fs.writeFileSync(path.join(sysLocales, 'en-US.pak'), 'binary pak data')
    fs.writeFileSync(path.join(sysLocales, 'zh-CN.pak'), 'binary pak data')

    // Authentic game locales in www/locales
    const gameLocales = path.join(tmpDir, 'www', 'locales')
    fs.mkdirSync(path.join(gameLocales, 'en'), { recursive: true })
    fs.mkdirSync(path.join(gameLocales, 'ch'), { recursive: true })
    fs.mkdirSync(path.join(gameLocales, 'ru'), { recursive: true })

    fs.writeFileSync(path.join(gameLocales, 'en', 'Act1.json'), JSON.stringify({ 'Map001-1': 'Hello world from English', 'HINT-1': 'English hint' }))
    fs.writeFileSync(path.join(gameLocales, 'ch', 'Act1.json'), JSON.stringify({ 'Map001-1': '你好世界来自中文', 'HINT-1': '中文提示' }))
    fs.writeFileSync(path.join(gameLocales, 'ru', 'Act1.json'), JSON.stringify({ 'Map001-1': 'Привет мир из России', 'HINT-1': 'Русская подсказка' }))

    // findLocalesDirectory should ignore the .pak directory and find www/locales
    const found = findLocalesDirectory(tmpDir)
    expect(found).toBe(gameLocales)

    // loadGameLocalesCatalog
    const catalog = loadGameLocalesCatalog(tmpDir)
    expect(catalog.hasLocales).toBe(true)
    expect(catalog.languages).toContain('en')
    expect(catalog.languages).toContain('ch')
    expect(catalog.languages).toContain('ru')
    expect(catalog.keyToFileMap['Map001-1']).toBe('Act1.json')

    // Parallel corpus extraction: text-to-text only, no keys
    const corpus = extractParallelCorpus(catalog)
    expect(corpus.length).toBeGreaterThan(0)
    for (const pair of corpus) {
      expect(pair.src).not.toMatch(/^\{?Map\d+/)
      expect(pair.zh).not.toMatch(/^\{?Map\d+/)
      expect(pair.engine).toBe('game:locales')
    }

    // loadExtractedItemsWithLocales
    const res = loadExtractedItemsWithLocales(tmpDir, { sourceLang: 'en', targetLang: 'ch' })
    expect(res.locales?.hasLocales).toBe(true)
    expect(res.items.length).toBeGreaterThanOrEqual(2)

    const mapItem = res.items.find((i) => i.meta.localesKey === 'Map001-1')
    expect(mapItem).toBeDefined()
    expect(mapItem?.src).toBe('Hello world from English')
    expect(mapItem?.zh).toBe('你好世界来自中文')
    expect(mapItem?.meta.localesFile).toBe('Act1.json')
  })

  it('safely backs up target file as .bak.json on first save and updates the json dictionary', () => {
    const gameLocales = path.join(tmpDir, 'locales', 'ch')
    fs.mkdirSync(gameLocales, { recursive: true })
    const targetFile = path.join(gameLocales, 'Act1.json')
    fs.writeFileSync(targetFile, JSON.stringify({ 'Map001-1': '原始未修改文本' }), 'utf8')

    const res1 = saveLocalesItem({
      contentRoot: tmpDir,
      localesKey: 'Map001-1',
      text: 'Hello world',
      zh: '全新修改后的译文',
      sourceLang: 'en',
      targetLang: 'ch',
      targetFile: 'Act1.json',
    })

    expect(res1.ok).toBe(true)
    expect(res1.backupCreated).toBe(true)

    // Backup file must exist with original content
    const backupFile = path.join(gameLocales, 'Act1.bak.json')
    expect(fs.existsSync(backupFile)).toBe(true)
    const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
    expect(backupData['Map001-1']).toBe('原始未修改文本')

    // Target file must contain updated text
    const updatedData = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
    expect(updatedData['Map001-1']).toBe('全新修改后的译文')

    // Second write should NOT overwrite the original backup
    const res2 = saveLocalesItem({
      contentRoot: tmpDir,
      localesKey: 'Map001-1',
      text: 'Hello world',
      zh: '第二次修改',
      sourceLang: 'en',
      targetLang: 'ch',
      targetFile: 'Act1.json',
    })

    expect(res2.ok).toBe(true)
    expect(res2.backupCreated).toBe(false)
    const backupData2 = JSON.parse(fs.readFileSync(backupFile, 'utf8'))
    expect(backupData2['Map001-1']).toBe('原始未修改文本')
  })
})
