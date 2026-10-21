import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveGame } from '@/lib/game/resolve'
import { looksLikeRgssProject, runRgssExtract, writeRgssTranslations } from '@/services/extract/lib/rgss'
import { parseRubyMarshal, type RubyValue, writeRubyMarshal } from '@/services/extract/lib/rgss/marshal'

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
  it('round-trips Ruby objects, strings, links and instance variables', () => {
    const value = array(object('RPG::Actor', { name: str('勇者'), nested: array(str('村')) }), str('勇者'))
    const parsed = parseRubyMarshal(writeRubyMarshal(value))
    expect(parsed).toEqual(value)
  })

  it.each([
    ['.rvdata2', 'VX Ace'],
    ['.rvdata', 'VX'],
  ] as const)('resolves %s projects as %s', (ext, engine) => {
    const root = makeProject(ext)
    try {
      expect(looksLikeRgssProject(root)).toBe(true)
      expect(resolveGame(root)).toMatchObject({ ok: true, engine, kind: 'rgss', hasShell: true })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts dialogue, choices and database text, then writes translations with a backup', () => {
    const root = makeProject()
    try {
      const extracted = runRgssExtract(root)
      expect([...extracted.allStrings]).toEqual(expect.arrayContaining(['こんにちは、勇者', 'はい', 'いいえ', 'アリス', '北から来た旅人']))
      const result = writeRgssTranslations(root, { 'こんにちは、勇者！': '你好，勇者！', アリス: '爱丽丝' })
      expect(result).toEqual({ files: 2, replacements: 2 })
      expect(fs.existsSync(path.join(root, 'Data', 'Map001.rvdata2.chaya.bak'))).toBe(true)
      expect(fs.existsSync(path.join(root, 'Data', 'Actors.rvdata2.chaya.bak'))).toBe(true)
      expect([...runRgssExtract(root).allStrings]).toEqual(expect.arrayContaining(['你好', '勇者', '爱丽丝']))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
