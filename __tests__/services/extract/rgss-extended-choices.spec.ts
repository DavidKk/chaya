jest.mock('@/constants/paths', () => ({ ...jest.requireActual('@/constants/paths'), TRANSLATE_CACHE_DB_PATH: '' }))
jest.mock('@/services/storage/game-files', () => jest.requireActual('@/__tests__/mocks/public-game-files'))

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { extractDialogueFromEvents } from '@/services/extract/lib/dialogue'
import { filterRgssSeedKeys, loadRgssTranslationItems, loadRgssTranslationItemsAsync, runRgssExtract } from '@/services/extract/lib/rgss'
import { parseRgssExtendedChoices } from '@/services/extract/lib/rgss/extended-choices'
import { parseRubyMarshal, rubyToPlain, type RubyValue, writeRubyMarshal } from '@/services/extract/lib/rgss/marshal'
import { loadRgssItems, restoreRgssFromBackup, writeRgssData } from '@/services/extract/lib/rgss/writeback'
import { ensureRgssSourcesIndex, rgssDataSignature, writeRgssSourcesIndex } from '@/services/extract/lib/rgss-sources-index'

function object(className: string, fields: Record<string, RubyValue>): RubyValue {
  return { kind: 'object', className, ivars: { kind: 'hash', pairs: Object.entries(fields).map(([key, value]) => ({ key: { kind: 'symbol', value: `@${key}` }, value })) } }
}

const str = (value: string): RubyValue => ({ kind: 'string', value })
const array = (...items: RubyValue[]): RubyValue => ({ kind: 'array', items })
const command = (code: number, text: string) => object('RPG::EventCommand', { code, indent: 0, parameters: array(str(text)) })
const MUSIC = String.raw`\I[255]Change lewd music`
const TOGGLE = String.raw`\I[341]Toggle queef`
const CHUNKS = [String.raw`拡張選択肢 0,205,[Cancel/Confirm,\I[255]Change lewd `, String.raw`music,\I[341]Toggle queef,\I`, String.raw`[358]\N[10] & \N[12]'s stats],左`]
const ZH_MUSIC = String.raw`\I[255]更换音乐`
const ZH_TOGGLE = String.raw`\I[341]切换音效`

function project(ext = '.rvdata2', chunks = CHUNKS) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-extended-choices-'))
  const data = path.join(root, 'Data')
  fs.mkdirSync(data)
  const commands = [...chunks.map((text, index) => command(index === 0 ? 108 : 408, text)), command(108, 'Developer comment'), command(408, 'Do not translate this.')]
  const value = array(null, object('RPG::CommonEvent', { id: 61, name: str('Settings'), list: array(...commands) }))
  const file = path.join(data, `CommonEvents${ext}`)
  fs.writeFileSync(file, writeRubyMarshal(value))
  return { root, data, file, bytes: fs.readFileSync(file) }
}

function event(file: string): any {
  return (rubyToPlain(parseRubyMarshal(fs.readFileSync(file))) as any[])[1]
}

describe('A1 extended choices stored in RGSS comment blocks', () => {
  it.each(['.rvdata', '.rvdata2'])('extracts complete labels and keeps them eligible for seed translation in %s', async (ext) => {
    const { root, data, file } = project(ext)
    try {
      const expected = ['Cancel/Confirm', MUSIC, TOGGLE, String.raw`\I[358]\N[10] & \N[12]'s stats`]
      expect(loadRgssItems(data).map((item) => item.src)).toEqual(expected)
      expect(extractDialogueFromEvents([event(file)], { src: 'common' })).toEqual([expect.objectContaining({ eid: 61, kind: 'c', choices: expected })])
      expect([...runRgssExtract(root).allStrings]).toEqual(expected)
      expect(loadRgssTranslationItems(root).map((item) => item.src)).toEqual(expected)
      expect((await loadRgssTranslationItemsAsync(root)).map((item) => item.src)).toEqual(expected)
      expect(filterRgssSeedKeys(root, [...expected, 'Developer comment', 'Do not translate this.'])).toEqual(expected)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes multiple labels across comment boundaries, preserves controls/configuration and supports repeat writes and restore', () => {
    const { root, data, file, bytes } = project()
    try {
      expect(writeRgssData(data, { [MUSIC]: ZH_MUSIC, [TOGGLE]: ZH_TOGGLE })).toMatchObject({ files: 1, replacements: 2, matched: 2, backupCreated: true })
      const current = event(file)
      expect(
        current.list
          .slice(0, 3)
          .map((cmd: any) => cmd.parameters[0])
          .join('')
      ).toBe(CHUNKS.join('').replace(MUSIC, ZH_MUSIC).replace(TOGGLE, ZH_TOGGLE))
      expect(current.list.map((cmd: any) => cmd.code)).toEqual([108, 408, 408, 108, 408])
      expect(current.list.slice(3)).toEqual(eventFromBytes(bytes).list.slice(3))
      expect(loadRgssItems(data).find((item) => item.src === MUSIC)).toMatchObject({ zh: ZH_MUSIC, meta: { category: 'choice' } })
      expect(loadRgssItems(data).find((item) => item.src === TOGGLE)).toMatchObject({ zh: ZH_TOGGLE })
      expect(writeRgssData(data, { [MUSIC]: ZH_MUSIC })).toMatchObject({ files: 0, replacements: 0 })
      const next = String.raw`\I[255]修改音乐`
      writeRgssData(data, { [MUSIC]: next })
      expect(loadRgssItems(data).find((item) => item.src === MUSIC)?.zh).toBe(next)
      expect(loadRgssItems(data).find((item) => item.src === TOGGLE)?.zh).toBe(ZH_TOGGLE)
      expect(fs.readFileSync(`${file}.chaya.bak`)).toEqual(bytes)
      expect(restoreRgssFromBackup(data).restored).toBe(1)
      expect(fs.readFileSync(file)).toEqual(bytes)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('invalidates a source index created before extended-choice extraction was supported', () => {
    const { root, data } = project()
    try {
      const oldSignature = JSON.stringify(
        fs
          .readdirSync(data)
          .sort()
          .map((name) => {
            const stat = fs.statSync(path.join(data, name))
            return [name, stat.size, stat.mtimeMs, stat.ctimeMs]
          })
      )
      writeRgssSourcesIndex(root, oldSignature, ['Old text'])
      expect(rgssDataSignature(data)).not.toBe(oldSignature)
      const build = jest.fn(() => loadRgssItems(data).map((item) => item.src))
      expect(ensureRgssSourcesIndex(root, data, build)).toContain(MUSIC)
      expect(ensureRgssSourcesIndex(root, data, build)).toContain(MUSIC)
      expect(build).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([
    String.raw`\I[341]Changed, extra choice`,
    String.raw`\I[341]Changed [nested]`,
    String.raw`\I[341]Changed` + '\nline',
    String.raw`\I[342]Changed`,
    'Changed without icon',
    String.raw`\I[341]<s>system("command")</s>`,
    String.raw`\I[341]@m(choice_method)`,
  ])('rejects unsafe translations before creating backups or writing any file: %s', (invalid) => {
    const { root, data, file, bytes } = project()
    try {
      expect(() => writeRgssData(data, { [MUSIC]: ZH_MUSIC, [TOGGLE]: invalid })).toThrow('Extended choice translation')
      expect(fs.readFileSync(file)).toEqual(bytes)
      expect(fs.existsSync(`${file}.chaya.bak`)).toBe(false)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('updates repeated labels in multiple blocks', () => {
    const { root, data, file } = project('.rvdata2', [String.raw`拡張選択肢 -1,,[Toggle queef,Toggle queef],10,20`])
    try {
      expect(writeRgssData(data, { 'Toggle queef': '切换音效' })).toMatchObject({ replacements: 2, matched: 2 })
      expect(event(file).list[0].parameters[0]).toBe('拡張選択肢 -1,,[切换音效,切换音效],10,20')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not split a surrogate pair across independently encoded Marshal strings', () => {
    const prefix = '拡張選択肢 0,20,['
    const { root, data, file } = project('.rvdata2', [`${prefix}A`, 'bc,Cancel],左'])
    try {
      const target = '\u{1F3B5}音乐'
      writeRgssData(data, { Abc: target })
      expect(
        event(file)
          .list.slice(0, 2)
          .map((cmd: any) => cmd.parameters[0])
          .join('')
      ).toBe(`${prefix}${target},Cancel],左`)
      expect(loadRgssItems(data).find((item) => item.src === 'Abc')?.zh).toBe(target)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

function eventFromBytes(bytes: Buffer): any {
  return (rubyToPlain(parseRubyMarshal(bytes)) as any[])[1]
}

describe('extended choice protocol parsing', () => {
  it.each([
    ['拡張選択肢 -1,,  First choice  ,Second choice', ['First choice', 'Second choice']],
    [String.raw`拡張選択肢 0,20,[\I[255]Change music,\N[10]'s stats],左,下`, [String.raw`\I[255]Change music`, String.raw`\N[10]'s stats`]],
    ['拡張選択肢 0,20,[Cancel,Confirm],12,-40', ['Cancel', 'Confirm']],
    ['拡張選択肢 0,20,[Cancel,Confirm],', ['Cancel', 'Confirm']],
  ])('parses literal choices with stable spans: %s', (raw, expected) => {
    const choices = parseRgssExtendedChoices(raw)!
    expect(choices.map((choice) => choice.text)).toEqual(expected)
    for (const choice of choices) expect(raw.slice(choice.start, choice.end)).toBe(choice.text)
  })

  it.each([
    'Ordinary English comment',
    '拡張選択肢X 0,20,[Cancel,Confirm]',
    '拡張選択肢 0,20,[Cancel,Confirm',
    '拡張選択肢 0,20,[Cancel,Confirm]],左',
    '拡張選択肢 0,20,[[Nested choice],Confirm]',
    '拡張選択肢 0,20,[Cancel,Confirm],Do not extract coordinates',
    '拡張選択肢 0,20,[Cancel,Confirm],0,0,Extra',
    '拡張選択肢 0,20,[<s>choice_method()</s>,Confirm]',
    '拡張選択肢 0,20,@m(choice_method)',
    '拡張選択肢 <s>1</s>,20,[Cancel,Confirm]',
  ])('ignores ordinary comments and unsupported configuration: %s', (raw) => {
    expect(parseRgssExtendedChoices(raw)).toBeNull()
    expect(extractDialogueFromEvents([{ id: 1, list: [{ code: 108, parameters: [raw] }] }], { src: 'common' })).toEqual([])
  })
})
