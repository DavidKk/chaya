import { DB_SPECS } from '@/lib/translate/database-fields'
import { buildTranslationExport } from '@/lib/translate/export'
import { reconcileTranslationSeed, translationOriginalSources, translationSources } from '@/lib/translate/segments'
import { detectSourceLanguage, isSourceText, type SourceLanguageOption } from '@/lib/translate/source-text'
import { extractDataFields } from '@/services/extract/lib/data-fields'
import { extractDialogueFromEvents } from '@/services/extract/lib/dialogue'
import { extractPluginsJsText } from '@/services/extract/lib/plugin-text'
import { clean, isUseful } from '@/services/extract/lib/text'
import { extractTextResource, textResourceFiles } from '@/services/extract/lib/text-resources'

import type { NodeFsPath } from '../../helpers/node/node-require'
import type { TranslationStore } from './store'

/** Read one data file asynchronously at a time using existing event and field rules; do not scan script strings. */
export async function extractPluginSeed(
  root: string,
  mods: NodeFsPath,
  store: TranslationStore,
  signal?: AbortSignal,
  options?: { entries?: boolean; sourceLanguage?: SourceLanguageOption }
) {
  const { fs, path } = mods
  const dataDir = path.join(root, 'data')
  const files = (await fs.promises.readdir(dataDir)).filter((name) => /\.json$/i.test(name)).sort()
  const strings = new Set<string>()
  const originals = new Set<string>()
  const extraFields = new Set<string>()
  const knownFields = new Set<string>()
  let locale = ''
  const add = (value: unknown) => {
    if (!isUseful(value)) return
    for (const part of translationSources(clean(value))) if (isUseful(part)) strings.add(clean(part))
    for (const part of translationOriginalSources(clean(value))) if (isUseful(part)) originals.add(part)
  }
  for (const file of files) {
    signal?.throwIfAborted()
    const data = JSON.parse(await fs.promises.readFile(path.join(dataDir, file), 'utf8'))
    for (const value of extractDataFields(data)) extraFields.add(value)
    for (const value of extractDataFields(data, { knownOnly: true })) knownFields.add(value)
    const spec = DB_SPECS.find(([name]) => name === file)
    if (spec) {
      for (const row of data || []) if (row) for (const field of spec[1]) add(row[field])
    } else if (file === 'System.json') {
      locale = typeof data.locale === 'string' ? data.locale : ''
      add(data.gameTitle)
      add(data.currencyUnit)
      for (const key of ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes', 'switches', 'variables']) for (const value of data[key] || []) add(value)
      for (const values of Object.values(data.terms || {})) {
        if (values && typeof values === 'object') for (const value of Object.values(values)) add(value)
      }
    } else if (/^(?:Map\d+|CommonEvents|Troops)\.json$/.test(file)) {
      const isMap = /^Map\d+/.test(file)
      if (isMap) {
        add(data.displayName)
        add(data.name)
        for (const event of data.events || []) if (event) add(event.name)
      }
      for (const block of extractDialogueFromEvents(isMap ? data.events : data, { src: file })) {
        if (block.kind === 'd' || block.kind === 's') add((block.lines || []).join('\n'))
        else for (const value of block.lines || []) add(value)
        for (const value of block.choices || []) add(value)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  for (const value of knownFields) add(value)
  const sourceLanguage = options?.sourceLanguage && options.sourceLanguage !== 'auto' ? options.sourceLanguage : detectSourceLanguage(strings.size ? strings : extraFields, locale)
  try {
    const pluginsJs = await fs.promises.readFile(path.join(root, 'js', 'plugins.js'), 'utf8')
    for (const text of extractPluginsJsText(pluginsJs)) add(text)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  for (const file of textResourceFiles(root, mods)) {
    signal?.throwIfAborted()
    for (const text of extractTextResource(file, await fs.promises.readFile(path.join(root, file), 'utf8'))) add(text)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  for (const value of extraFields) add(value)
  for (const value of strings) if (!isSourceText(value, sourceLanguage)) strings.delete(value)
  for (const value of originals) if (!isSourceText(value, sourceLanguage)) originals.delete(value)
  await store.load()
  const { seed, entries, added } = reconcileTranslationSeed(strings, store.seed())
  signal?.throwIfAborted()
  await store.writeJson('seed', seed)
  await store.load()
  return {
    unique: strings.size,
    added,
    total: Object.keys(seed).length,
    ...(options?.entries ? { entries: buildTranslationExport(entries, (source) => store.lookup(source), originals) } : {}),
  }
}
