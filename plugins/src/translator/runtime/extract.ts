import { DB_SPECS } from '@/lib/translate/database-fields'
import { extractDialogueFromEvents } from '@/services/extract/lib/dialogue'
import { extractPluginsJsText } from '@/services/extract/lib/plugin-text'
import { clean, isUseful } from '@/services/extract/lib/text'

import type { NodeFsPath } from '../../helpers/node/node-require'
import type { TranslationStore } from './store'

/** 每次异步读取一个 data 文件，沿用既有事件与字段规则，不扫描脚本字符串。 */
export async function extractPluginSeed(root: string, mods: NodeFsPath, store: TranslationStore, signal?: AbortSignal) {
  const { fs, path } = mods
  const dataDir = path.join(root, 'data')
  const files = (await fs.promises.readdir(dataDir)).filter((name) => /^(Map\d+|CommonEvents|Troops|System)\.json$/.test(name) || DB_SPECS.some(([file]) => file === name)).sort()
  const strings = new Set<string>()
  const add = (value: unknown) => {
    if (isUseful(value)) strings.add(clean(value))
  }
  for (const file of files) {
    signal?.throwIfAborted()
    const data = JSON.parse(await fs.promises.readFile(path.join(dataDir, file), 'utf8'))
    const spec = DB_SPECS.find(([name]) => name === file)
    if (spec) {
      for (const row of data || []) if (row) for (const field of spec[1]) add(row[field])
    } else if (file === 'System.json') {
      add(data.gameTitle)
      add(data.currencyUnit)
      for (const key of ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes', 'switches', 'variables']) for (const value of data[key] || []) add(value)
      for (const values of Object.values(data.terms || {})) {
        if (values && typeof values === 'object') for (const value of Object.values(values)) add(value)
      }
    } else {
      const isMap = /^Map\d+/.test(file)
      if (isMap) add(data.displayName)
      for (const block of extractDialogueFromEvents(isMap ? data.events : data, { src: file })) {
        for (const value of [...(block.lines || []), ...(block.choices || [])]) add(value)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  try {
    const pluginsJs = await fs.promises.readFile(path.join(root, 'js', 'plugins.js'), 'utf8')
    for (const text of extractPluginsJsText(pluginsJs)) add(text)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await store.load()
  const seed = { ...store.seed() }
  let added = 0
  for (const src of strings) {
    if (!Object.prototype.hasOwnProperty.call(seed, src)) {
      seed[src] = ''
      added++
    }
  }
  signal?.throwIfAborted()
  await store.writeJson('seed', seed)
  await store.load()
  return { unique: strings.size, added, total: Object.keys(seed).length }
}
