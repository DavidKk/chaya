import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Guard for docs/technical/game-agent.md「语义判断不用文本匹配」: the Agent pipeline must not
 * decide intent, targets, safety or display by matching natural-language words.
 */
const ROOT = path.resolve(__dirname, '../../..')
const DIRS = ['lib/game-agent', 'services/game-agent', 'plugins/src/agent', 'plugins/src/agent-ui', 'components/game-agent', 'app/api/game-agent']
const NATURAL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}]/u
const REGEX_LITERAL = /(?:^|[(=:,!&|?;{}[]|return)\s*(\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\[\n])+\/[dgimsuyv]*)/g
const NEW_REGEXP = /new RegExp\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g
const STRING_PROBE = /\.(?:includes|startsWith|endsWith|indexOf|split|replace|replaceAll)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g
const FREE_TEXT = /\.(?:test|match|matchAll|search|exec)\(\s*(?:[\w$]+(?:\?\.|\.))*(?:prompt|goal|request|reply|answer|hint|question|selectedText|userText|playerText)\b/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) return sources(file)
    return /\.(?:ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) ? [file] : []
  })
}

function findings(file: string): string[] {
  const out: string[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((raw, index) => {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return
      const where = `${path.relative(ROOT, file)}:${index + 1}`
      for (const match of line.matchAll(REGEX_LITERAL)) if (NATURAL.test(match[1])) out.push(`${where} keyword regex ${match[1]}`)
      for (const match of line.matchAll(NEW_REGEXP)) if (NATURAL.test(match[2])) out.push(`${where} keyword RegExp ${match[2]}`)
      for (const match of line.matchAll(STRING_PROBE)) if (NATURAL.test(match[2])) out.push(`${where} keyword probe ${match[0]}`)
      if (FREE_TEXT.test(line)) out.push(`${where} matches free text: ${line.slice(0, 120)}`)
    })
  return out
}

test('the Agent pipeline never routes or judges by natural-language keyword matching', () => {
  const found = DIRS.flatMap((dir) => sources(path.join(ROOT, dir))).flatMap(findings)
  expect(found).toEqual([])
})

test('the guard itself catches the patterns it is meant to forbid', () => {
  const lines = [
    "if (/(?:交互|互动)/u.test(input.prompt)) return 'play'",
    'const forbidden = /escape|flee/i.test(selectedText)',
    "const npc = new RegExp('商人|村民').test(name)",
    "lines.filter((line) => line.startsWith('剧情摘要：'))",
  ]
  const hits = lines.filter(
    (line) =>
      [...line.matchAll(REGEX_LITERAL)].some((match) => NATURAL.test(match[1])) ||
      [...line.matchAll(NEW_REGEXP)].some((match) => NATURAL.test(match[2])) ||
      [...line.matchAll(STRING_PROBE)].some((match) => NATURAL.test(match[2])) ||
      FREE_TEXT.test(line)
  )
  expect(hits).toEqual(lines)
})
