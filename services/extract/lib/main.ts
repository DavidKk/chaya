import fs from 'node:fs'
import path from 'node:path'

import { gameContentPath, gameContentReadPath } from '../../../lib/game/content-files'
import { collectAllStrings, compareWithManual } from './compare'
import { extractDatabase, loadJson } from './database'
import { extractDialogueFromEvents } from './dialogue'

export function resolveContentRoot(argv = process.argv.slice(2)) {
  const eq = argv.find((a) => a.startsWith('--root='))
  if (eq) return path.resolve(eq.slice('--root='.length))
  const i = argv.indexOf('--root')
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1])
  if (process.env.CHAYA_CONTENT_ROOT) return path.resolve(process.env.CHAYA_CONTENT_ROOT)
  return process.cwd()
}

export function runExtract(contentRoot: string) {
  const DATA = path.join(contentRoot, 'data')
  const MANUAL = gameContentReadPath(contentRoot, 'seed')
  const OUT = gameContentPath(contentRoot, 'extractStrings')
  const COMPARE = gameContentPath(contentRoot, 'extractCompare')

  if (!fs.existsSync(DATA)) {
    throw new Error(`找不到 data/：${DATA}`)
  }

  const dialogue: any[] = []
  const mapFiles = fs
    .readdirSync(DATA)
    .filter((f) => /^Map\d+\.json$/.test(f))
    .sort()
  for (const file of mapFiles) {
    const map = loadJson(path.join(DATA, file))
    const mapId = Number(file.match(/Map(\d+)/)?.[1])
    dialogue.push(...extractDialogueFromEvents(map.events || [], { map: mapId }))
  }

  const common = loadJson(path.join(DATA, 'CommonEvents.json'))
  dialogue.push(...extractDialogueFromEvents(common || [], { src: 'common' }))

  const troops = loadJson(path.join(DATA, 'Troops.json'))
  dialogue.push(...extractDialogueFromEvents(troops || [], { src: 'troop' }))

  const db = extractDatabase(DATA)
  const allStrings = collectAllStrings(dialogue, db)
  const counts: Record<string, number> = {
    dialogueBlocks: dialogue.length,
    dialogueLines: new Set(dialogue.flatMap((b) => b.lines || [])).size,
    dialogueChoices: new Set(dialogue.flatMap((b) => b.choices || [])).size,
    uniqueStrings: allStrings.size,
  }
  for (const [name, entries] of Object.entries(db)) {
    counts[name] = Array.isArray(entries) ? entries.length : 0
  }

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'data/*.json',
      note: '精简抽取：dialogue=游玩顺序；db=数据库字段。无 flat / 无引擎调试字段。',
      counts,
    },
    dialogue,
    db,
  }

  fs.writeFileSync(OUT, JSON.stringify(result) + '\n')

  let compare: Record<string, unknown> = { manualExists: false }
  if (MANUAL) {
    compare = compareWithManual(allStrings, dialogue, loadJson(MANUAL))
    fs.writeFileSync(COMPARE, JSON.stringify(compare, null, 2) + '\n')
  }

  return { OUT, COMPARE, allStrings, dialogue, counts, compare }
}

export function main() {
  const contentRoot = resolveContentRoot()
  console.log(`[extract] contentRoot = ${contentRoot}`)
  const { OUT, COMPARE, allStrings, dialogue, counts, compare } = runExtract(contentRoot)
  const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(1)
  console.log(`写入 ${path.basename(OUT)}（${sizeKb} KB）`)
  console.log(`唯一字符串 ${allStrings.size}；对话块 ${dialogue.length}；分类：`, counts)
  if (compare.manualExists) {
    console.log(`对照种子表：命中 ${compare.extractedAlsoInManual}，抽取多出 ${compare.extractedNotInManual}，种子多出 ${compare.manualNotInExtracted}`)
    console.log(`写入 ${path.basename(COMPARE)}`)
  }
}
