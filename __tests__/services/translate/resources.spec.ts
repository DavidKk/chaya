jest.mock('wordguard', () => ({ wordguard: () => ({ matchAll: () => [] }) }))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createResourceMatcher } from '@/lib/translate/resource-matcher'
import type { ResourceEntry, ResourcePack, VocalRule } from '@/lib/translate/resource-types'
import { createTranslationObservationStore } from '@/services/storage/translation-observation-store'
import { createTranslationResourceStore } from '@/services/storage/translation-resource-store'
import { spoolTranslationObservations } from '@/services/translate/observations/spool'
import { defaultResourcePack } from '@/services/translate/resources/defaults'
import { loadResourceMatcher } from '@/services/translate/resources/snapshot'
import { parseResourcePack, serializeResourcePack } from '@/services/translate/resources/validate'

const pair = { sourceLanguage: 'ja', targetLanguage: 'zh' }
const entry: ResourceEntry = {
  ...pair,
  type: 'entry',
  entryId: 'sample',
  sourceText: 'ああ',
  targetText: '啊啊',
  scope: { kind: 'global' },
  reviewStatus: 'reviewed',
  provenance: { kind: 'test' },
  match: { kind: 'exact' },
}
function pack(records: ResourcePack['records'] = [entry], version = '1', packId = 'test'): ResourcePack {
  return {
    manifest: {
      type: 'manifest',
      schemaVersion: 1,
      packId,
      version,
      languages: [
        { tag: 'ja', name: 'Japanese' },
        { tag: 'zh', name: 'Chinese' },
      ],
    },
    records,
  }
}
function matcher(records: ResourcePack['records']) {
  return createResourceMatcher({ revision: 3, languages: [], packs: [{ ...pack(records), hash: 'test', revision: 3 }] })
}
const rule: VocalRule = {
  ...pair,
  type: 'vocal_rule',
  entryId: 'vocal',
  scope: { kind: 'global' },
  reviewStatus: 'reviewed',
  provenance: { kind: 'test' },
  templateKind: 'vocal-sequence',
  units: { あ: '啊' },
  modifiers: { punctuation: ['.', '!', ',', '…'], minUnits: 2, maxUnits: 20, maxInputLength: 100 },
}

describe('resource data and bounded matcher', () => {
  it('validates the complete migrated default pack', () => {
    expect(parseResourcePack(serializeResourcePack(defaultResourcePack)).records.length).toBeGreaterThan(250)
  })
  it('preserves punctuation, count and positions with an explicitly reviewed template', () => {
    for (const source of ['ああ...あ!!!!', 'あ,あ.........', 'あああああ', 'あ…あ']) {
      expect(matcher([rule]).match(source, pair)?.targetText).toBe(source.replaceAll('あ', '啊'))
    }
  })
  it('falls back for mixed dialogue, unknown modifiers, out of bounds and candidates', () => {
    for (const source of ['ああ逃げて', 'ああー', 'あ', 'あ'.repeat(21)]) expect(matcher([rule]).match(source, pair)).toBeNull()
    expect(matcher([{ ...rule, reviewStatus: 'candidate' }]).match('ああ', pair)).toBeNull()
  })
  it('rejects ambiguous segmentation and conflicting full entries without template fallback', () => {
    expect(matcher([{ ...rule, units: { あ: '啊', ああ: '呜' }, modifiers: { ...rule.modifiers, minUnits: 1 } }]).match('ああ', pair)).toBeNull()
    expect(matcher([entry, { ...entry, entryId: 'other', targetText: '呜呜' }, rule]).match('ああ', pair)).toBeNull()
  })
  it('uses full examples before templates and never infers a reverse language pair', () => {
    expect(matcher([entry, rule]).match('ああ', pair)).toMatchObject({ entryId: 'sample', matchKind: 'exact', revision: 3 })
    expect(matcher([entry]).match('啊啊', { sourceLanguage: 'zh', targetLanguage: 'ja' })).toBeNull()
    expect(matcher([entry]).match('ああ', { sourceLanguage: 'ja', targetLanguage: 'zh-Hant' })).toBeNull()
  })
  it('uses game scope and explicit conditions without guessing absent context', () => {
    const scoped: ResourceEntry = { ...entry, entryId: 'game', scope: { kind: 'game', gameId: 'g' }, targetText: '呜呜', conditions: { speaker: 'hero' } }
    expect(matcher([entry, scoped]).match('ああ', pair)?.targetText).toBe('啊啊')
    expect(matcher([entry, scoped]).match('ああ', { ...pair, gameId: 'g', speaker: 'hero' })?.targetText).toBe('呜呜')
  })
  it('only unwraps boundaries for explicitly allowed examples', () => {
    expect(matcher([entry]).match('「ああ」!!!!', pair)).toBeNull()
    expect(matcher([{ ...entry, match: { kind: 'exact', allowBoundary: true } }]).match('「ああ」!!!!', pair)?.targetText).toBe('「啊啊」!!!!')
  })
  it.each([
    { ...entry, sourceText: '\\V[1]ああ', targetText: '啊啊' },
    { ...entry, sourceText: '%s ああ', targetText: '%d 啊啊' },
    { ...entry, aliases: ['{hero}ああ'] },
    { ...entry, sourceLanguage: 'zh_hant' },
    { ...rule, modifiers: { ...rule.modifiers, punctuation: [''] } },
    { ...rule, units: { あ: '' } },
    { ...rule, modifiers: { ...rule.modifiers, maxUnits: 99999 } },
    { ...entry, type: 'regex' },
  ])('rejects malformed resources atomically: %#', (record) => {
    expect(() => parseResourcePack(serializeResourcePack(pack([record as ResourceEntry])))).toThrow()
  })
})

describe('resource lifecycle and durable evidence', () => {
  let directory: string, file: string, db: DatabaseSync
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-resources-'))
    file = path.join(directory, 'shared.sqlite')
    db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode=WAL')
  })
  afterEach(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  it('previews, imports idempotently, hot updates, disables and rolls back', () => {
    const store = createTranslationResourceStore(db)
    const input = serializeResourcePack(pack())
    const preview = store.preview(input)
    store.apply(input, preview.token)
    const revision = store.snapshot().revision
    expect(store.apply(input, store.preview(input).token).revision).toBe(revision)
    expect(loadResourceMatcher(file).match('ああ', pair)?.targetText).toBe('啊啊')
    const second = serializeResourcePack(pack([{ ...entry, targetText: '呜呜' }], '2'))
    store.apply(second, store.preview(second).token)
    expect(loadResourceMatcher(file).match('ああ', pair)?.targetText).toBe('呜呜')
    expect(() => store.apply(input, preview.token)).toThrow('stale')
    expect(() => store.preview(serializeResourcePack(pack([{ ...entry, targetText: '不一样' }])))).toThrow('immutable')
    store.disable('test')
    expect(loadResourceMatcher(file).match('ああ', pair)).toBeNull()
    const disabledRevision = store.snapshot().revision
    store.apply(second, store.preview(second).token)
    expect(store.snapshot().revision).toBe(disabledRevision)
    expect(loadResourceMatcher(file).match('ああ', pair)).toBeNull()
    store.activate('test', '1')
    expect(loadResourceMatcher(file).match('ああ', pair)?.targetText).toBe('啊啊')
    expect(store.export('test', '1')).toBe(input)
  })
  it('does not reinstall disabled defaults and allows a new language from data alone', () => {
    const store = createTranslationResourceStore(db)
    store.disable('chaya.defaults')
    createTranslationResourceStore(db)
    expect(loadResourceMatcher(file).match('Save', { sourceLanguage: 'en', targetLanguage: 'zh' })).toBeNull()
    const french = pack([{ ...entry, sourceLanguage: 'fr', sourceText: 'Aïe', targetText: '哎哟' }])
    french.manifest.languages.push({ tag: 'fr', name: 'Français' })
    const input = serializeResourcePack(french)
    store.apply(input, store.preview(input).token)
    expect(loadResourceMatcher(file).match('Aïe', { sourceLanguage: 'fr', targetLanguage: 'zh' })?.targetText).toBe('哎哟')
  })
  it('reports conflicts without silently selecting another entry', () => {
    const store = createTranslationResourceStore(db)
    const input = serializeResourcePack(pack([entry, { ...entry, entryId: 'different', targetText: '呜' }]))
    expect(store.preview(input).conflicts).toEqual(['sample', 'different'])
  })
  it('persists/replays evidence idempotently and exports with a stable cursor', () => {
    const store = createTranslationObservationStore(db)
    const event = { eventId: 'event-1', occurredAt: 10, sourceText: 'あっ', targetText: null, ...pair, error: 'engine failed' }
    spoolTranslationObservations([event], path.join(directory, 'pending'))
    const spool = fs.readdirSync(path.join(directory, 'pending'))
    const events = fs
      .readFileSync(path.join(directory, 'pending', spool[0]), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(store.append(events)).toEqual({ inserted: 1 })
    expect(store.append(events)).toEqual({ inserted: 0 })
    expect(() => store.append([{ ...event, error: 'different' }])).toThrow('reused')
    const page = store.export({ sourceLanguage: 'ja' })
    expect(page.items).toEqual([event])
    expect(store.export({ after: page.nextCursor }).items).toEqual([])
  })
})
