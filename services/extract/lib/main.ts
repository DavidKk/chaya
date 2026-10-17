import fs from 'node:fs'
import path from 'node:path'

import { ensureGameContentDir, gameContentPath, gameContentReadPath } from '../../../lib/game/content-files'
import { detectSourceLanguage, isSourceText, type SourceLanguageOption } from '../../../lib/translate/source-text'
import { collectAllStrings, compareWithManual } from './compare'
import { extractDataFields } from './data-fields'
import { extractDatabase, loadJson } from './database'
import { extractDialogueFromEvents } from './dialogue'
import { extractPluginsJsText } from './plugin-text'
import { extractTextResource, textResourceFiles } from './text-resources'

export function resolveContentRoot(argv = process.argv.slice(2)) {
  const eq = argv.find((a) => a.startsWith('--root='))
  if (eq) return path.resolve(eq.slice('--root='.length))
  const i = argv.indexOf('--root')
  if (i >= 0 && argv[i + 1]) return path.resolve(argv[i + 1])
  if (process.env.CHAYA_CONTENT_ROOT) return path.resolve(process.env.CHAYA_CONTENT_ROOT)
  return process.cwd()
}

export function runExtract(contentRoot: string, options?: { sourceLanguage?: SourceLanguageOption }) {
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
  const preferredFields = new Set<string>()
  const candidates = new Set<string>()
  for (const file of fs
    .readdirSync(DATA)
    .filter((name) => /\.json$/i.test(name))
    .sort()) {
    const data = loadJson(path.join(DATA, file))
    for (const value of extractDataFields(data, { knownOnly: true })) preferredFields.add(value)
    for (const value of extractDataFields(data)) candidates.add(value)
  }
  db.textFields = [...preferredFields]
  const knownSources = collectAllStrings(dialogue, db)
  const sourceLanguage =
    options?.sourceLanguage && options.sourceLanguage !== 'auto'
      ? options.sourceLanguage
      : detectSourceLanguage(knownSources.size ? knownSources : collectAllStrings([], { dataFields: [...candidates] }), loadJson(path.join(DATA, 'System.json')).locale)
  const pluginsFile = path.join(contentRoot, 'js', 'plugins.js')
  if (fs.existsSync(pluginsFile)) db.plugins = extractPluginsJsText(fs.readFileSync(pluginsFile, 'utf8'))
  db.resources = [...new Set([...textResourceFiles(contentRoot, { fs, path })].flatMap((file) => extractTextResource(file, fs.readFileSync(path.join(contentRoot, file), 'utf8'))))]
  // Unknown fields remain available, after dialogue, database prose and plugin text.
  db.dataFields = [...candidates]
  const allStrings = new Set([...collectAllStrings(dialogue, db)].filter((text) => isSourceText(text, sourceLanguage)))
  const originalStrings = new Set([...collectAllStrings(dialogue, db, { original: true })].filter((text) => isSourceText(text, sourceLanguage)))
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
      sourceLanguage,
      source: 'data/*.json + js/plugins.js parameters + additional JSON/CSV/TXT',
      note: 'dialogue=游玩顺序；db=数据库文案、名称、备注正文及插件参数。按原语言过滤，忽略资源标识、配置与脚本。',
      counts,
    },
    dialogue,
    db,
  }

  fs.writeFileSync(ensureGameContentDir(contentRoot, 'extractStrings'), JSON.stringify(result) + '\n')

  let compare: Record<string, unknown> = { manualExists: false }
  if (MANUAL) {
    compare = compareWithManual(allStrings, dialogue, loadJson(MANUAL))
  }

  fs.writeFileSync(ensureGameContentDir(contentRoot, 'extractCompare'), JSON.stringify(compare, null, 2) + '\n')

  return { OUT, COMPARE, allStrings, originalStrings, dialogue, counts, compare }
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
