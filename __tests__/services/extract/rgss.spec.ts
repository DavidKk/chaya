import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveGame } from '@/lib/game/resolve'
import { runExtract } from '@/services/extract/lib/main'
import { loadRgssTranslationItems, looksLikeRgssProject, runRgssExtract, writeRgssTranslations } from '@/services/extract/lib/rgss'
import { parseRubyMarshal, rubyToPlain, type RubyValue, writeRubyMarshal } from '@/services/extract/lib/rgss/marshal'

function object(className: string, fields: Record<string, RubyValue>): RubyValue {
  return {
    kind: 'object',
    className,
    ivars: {
      kind: 'hash',
      pairs: Object.entries(fields).map(([key, value]) => ({ key: { kind: 'symbol', value: `@${key}` }, value })),
    },
  }
}

function hash(entries: Record<string, RubyValue>): RubyValue {
  return {
    kind: 'hash',
    pairs: Object.entries(entries).map(([key, value]) => ({ key: { kind: 'symbol', value: key }, value })),
  }
}

function str(value: string): RubyValue {
  return { kind: 'string', value }
}

function array(...items: RubyValue[]): RubyValue {
  return { kind: 'array', items }
}

function writeData(root: string, name: string, value: RubyValue, ext = '.rvdata2') {
  fs.writeFileSync(path.join(root, 'Data', `${name}${ext}`), writeRubyMarshal(value))
}

function makeProject(ext = '.rvdata2') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chaya-rgss-'))
  fs.mkdirSync(path.join(root, 'Data'))
  fs.writeFileSync(path.join(root, 'Game.exe'), '')
  const command = object('RPG::EventCommand', { code: 401, parameters: array(str('こんにちは、勇者！')) })
  const choice = object('RPG::EventCommand', { code: 102, parameters: array(array(str('はい'), str('いいえ'))) })
  const page = object('RPG::Event::Page', { list: array(command, choice) })
  const event = object('RPG::Event', { pages: array(page) })
  writeData(root, 'Map001', hash({ events: hash({ '1': event }) }), ext)
  writeData(root, 'Actors', array(null, object('RPG::Actor', { name: str('アリス'), nickname: str('勇者'), profile: str('北から来た旅人') })), ext)
  writeData(root, 'System', object('RPG::System', { game_title: str('小さな冒険') }), ext)
  return root
}

describe('RGSS VX/VX Ace support', () => {
  it('includes system parameter labels but excludes numeric actor params', () => {
    const root = makeProject()
    try {
      writeData(root, 'System', object('RPG::System', { terms: object('RPG::System::Terms', { params: array(str('最大体力')) }) }))
      expect(loadRgssTranslationItems(root)).toEqual(expect.arrayContaining([expect.objectContaining({ src: '最大体力', meta: expect.objectContaining({ category: 'system' }) })]))
      expect(writeRgssTranslations(root, { 最大体力: '最大生命' }).replacements).toBe(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it('round-trips Ruby objects, strings, links and instance variables', () => {
    const shared = str('共享对象')
    const value = array(object('RPG::Actor', { name: str('勇者'), nested: array(str('村')) }), shared, shared)
    const parsed = parseRubyMarshal(writeRubyMarshal(value))
    expect(parsed).toEqual(value)
    if (!parsed || typeof parsed !== 'object' || parsed.kind !== 'array') throw new Error('expected array')
    expect(parsed.items[1]).toBe(parsed.items[2])
  })

  it('round-trips user-defined and structured Marshal values', () => {
    const value: RubyValue = array(
      { kind: 'user-defined', className: 'Table', data: Uint8Array.from([1, 2, 3, 4]) },
      { kind: 'user-marshal', className: 'RPG::Tone', value: object('Tone', { red: 1 }) },
      { kind: 'user-class', className: 'RPG::Color', value: array(str('rgba')) },
      { kind: 'struct', className: 'Rational', members: [{ key: { kind: 'symbol', value: 'numerator' }, value: 1 }] },
      { kind: 'float', value: '1.25' },
      { kind: 'bignum', sign: '+', bytes: Uint8Array.from([1, 0]) }
    )
    expect(parseRubyMarshal(writeRubyMarshal(value))).toEqual(value)
  })

  it.each([
    ['.rvdata2', 'VX Ace'],
    ['.rvdata', 'VX'],
  ] as const)('resolves %s projects as %s', (ext, engine) => {
    const root = makeProject(ext)
    try {
      expect(looksLikeRgssProject(root)).toBe(true)
      expect(resolveGame(root)).toMatchObject({ ok: true, engine, kind: 'rgss', hasShell: process.platform === 'win32' })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts dialogue, choices and database text, then writes translations with a backup', () => {
    const root = makeProject()
    try {
      const extracted = runRgssExtract(root)
      expect([...extracted.allStrings]).toEqual(expect.arrayContaining(['こんにちは、勇者！', 'はい', 'いいえ', 'アリス', '北から来た旅人']))
      const result = writeRgssTranslations(root, { 'こんにちは、勇者！': '你好，勇者！', アリス: '爱丽丝' })
      expect(result).toMatchObject({ files: 2, replacements: 2, matched: 2, backupCreated: true })
      expect(fs.existsSync(path.join(root, 'Data', 'Map001.rvdata2.chaya.bak'))).toBe(true)
      expect(fs.existsSync(path.join(root, 'Data', 'Actors.rvdata2.chaya.bak'))).toBe(true)
      expect([...runRgssExtract(root).allStrings]).toEqual(expect.arrayContaining(['こんにちは、勇者！', 'アリス']))
      expect(loadRgssTranslationItems(root)).toEqual(expect.arrayContaining([expect.objectContaining({ src: 'アリス', zh: '爱丽丝', savedZh: '爱丽丝' })]))
      const originalBackup = fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2.chaya.bak'))
      expect(writeRgssTranslations(root, { アリス: '艾莉丝' })).toMatchObject({ replacements: 1, backupCreated: false })
      expect(writeRgssTranslations(root, { アリス: '艾莉丝' })).toMatchObject({ files: 0, replacements: 0, matched: 1 })
      expect(fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2.chaya.bak'))).toEqual(originalBackup)
      expect(loadRgssTranslationItems(root)).toEqual(expect.arrayContaining([expect.objectContaining({ src: 'アリス', zh: '艾莉丝' })]))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('updates repeated visible text together across data files', () => {
    const root = makeProject()
    try {
      writeData(root, 'System', object('RPG::System', { game_title: str('小さな冒険'), nickname: str('アリス') }))
      const before = fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2'))
      const systemBefore = fs.readFileSync(path.join(root, 'Data', 'System.rvdata2'))
      const result = writeRgssTranslations(root, { アリス: '爱丽丝', 小さな冒険: '小小冒险' })
      expect(result).toMatchObject({ files: 2, replacements: 3, matched: 3 })
      expect(fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2'))).not.toEqual(before)
      expect(fs.readFileSync(path.join(root, 'Data', 'System.rvdata2'))).not.toEqual(systemBefore)
      expect(loadRgssTranslationItems(root)).toEqual(expect.arrayContaining([expect.objectContaining({ src: 'アリス', zh: '爱丽丝' })]))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('routes a Data-only project through RGSS extraction', () => {
    const root = makeProject('.rvdata')
    try {
      fs.unlinkSync(path.join(root, 'Game.exe'))
      expect(resolveGame(root)).toMatchObject({ ok: true, engine: 'VX', hasShell: false })
      expect(runExtract(root).allStrings.has('こんにちは、勇者！')).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not translate scripts or asset references sharing the dialogue string', () => {
    const root = makeProject()
    try {
      const shared = str('アリス')
      writeData(root, 'Actors', array(null, object('RPG::Actor', { name: shared, character_name: shared })))
      writeData(root, 'CommonEvents', array(object('RPG::CommonEvent', { list: array(object('RPG::EventCommand', { code: 355, parameters: array(str('アリス')) })) })))
      expect(writeRgssTranslations(root, { アリス: '爱丽丝' })).toMatchObject({ replacements: 1 })
      const value = rubyToPlain(parseRubyMarshal(fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2')))) as any[]
      expect(value[1]).toMatchObject({ name: '爱丽丝', character_name: 'アリス' })
      const common = rubyToPlain(parseRubyMarshal(fs.readFileSync(path.join(root, 'Data', 'CommonEvents.rvdata2')))) as any[]
      expect(common[0].list[0].parameters).toEqual(['アリス'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects missing sources before modifying any files', () => {
    const root = makeProject()
    try {
      const before = fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2'))
      expect(() => writeRgssTranslations(root, { アリス: '爱丽丝', 不存在: 'missing' })).toThrow(/source not found/)
      expect(fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2'))).toEqual(before)
      fs.writeFileSync(path.join(root, 'Data', 'System.rvdata2'), 'invalid')
      expect(() => writeRgssTranslations(root, { アリス: '爱丽丝' })).toThrow(/Marshal/)
      expect(fs.readFileSync(path.join(root, 'Data', 'Actors.rvdata2'))).toEqual(before)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rolls back earlier files when a multi-file write fails', () => {
    const root = makeProject()
    const actor = path.join(root, 'Data', 'Actors.rvdata2')
    const map = path.join(root, 'Data', 'Map001.rvdata2')
    const before = [fs.readFileSync(actor), fs.readFileSync(map)]
    const rename = fs.renameSync.bind(fs)
    const spy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (to === map) throw new Error('Disk write failed')
      rename(from, to)
    })
    try {
      expect(() => writeRgssTranslations(root, { アリス: '爱丽丝', 'こんにちは、勇者！': '你好！' })).toThrow('Disk write failed')
      expect([fs.readFileSync(actor), fs.readFileSync(map)]).toEqual(before)
      expect(fs.readdirSync(path.join(root, 'Data')).some((name) => name.startsWith('.chaya-rgss-'))).toBe(false)
    } finally {
      spy.mockRestore()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  // These bytes were generated by Ruby's Marshal.dump, independently of this writer.
  it.each([
    '04085b096609312e32356c2b0b00000000000000000000010049220b736861726564063a0645544008',
    '04085b0b69f5698069ff8469ff7f69ff0069fefffe',
    '04085b072209789cff00492208e69d91063a064554',
    '04085b08433a0a46616e63795b0649220974657874063a06455449220b736861726564063b06544008',
    '04085b08492f0861626301063a06454649220b736861726564063b00544007',
  ])('round-trips genuine Ruby Marshal bytes %s', (hex) => {
    const bytes = Buffer.from(hex, 'hex')
    const parsed = parseRubyMarshal(bytes)
    expect(Buffer.from(writeRubyMarshal(parsed))).toEqual(bytes)
  })

  it('decodes Ruby negative fixnums correctly', () => {
    const parsed = parseRubyMarshal(Buffer.from('04085b0b69f5698069ff8469ff7f69ff0069fefffe', 'hex'))
    expect(rubyToPlain(parsed)).toEqual([-6, -123, -124, -129, -256, -257])
  })

  it('preserves legacy float mantissa bytes found in real VX Ace equipment data', () => {
    const bytes = Buffer.concat([Buffer.from([4, 8, 102, 27]), Buffer.from('0.80000000000000004\0'), Buffer.from([0x99, 0x9a])])
    const parsed = parseRubyMarshal(bytes)
    expect(rubyToPlain(parsed)).toBe(0.8)
    expect(Buffer.from(writeRubyMarshal(parsed))).toEqual(bytes)
  })
})
