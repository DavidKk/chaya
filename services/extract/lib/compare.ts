import { translationOriginalSources, translationSources } from '@/lib/translate/segments'

export function collectAllStrings(dialogue: any[], db: Record<string, unknown>, options?: { original?: boolean }) {
  const set = new Set<string>()
  const add = (text: string) => {
    for (const part of options?.original ? translationOriginalSources(text) : translationSources(text)) if (part.trim()) set.add(options?.original ? part : part.trim())
  }
  for (const block of dialogue) {
    if (block.kind === 'd' || block.kind === 's') add((block.lines || []).join('\n'))
    else for (const line of block.lines || []) add(line)
    for (const choice of block.choices || []) add(choice)
  }
  for (const entries of Object.values(db)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (typeof entry === 'string') {
        add(entry)
        continue
      }
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'id') continue
        if (typeof value === 'string') add(value)
      }
    }
  }
  return set
}

export function compareWithManual(allStrings: Set<string>, dialogue: any[], manual: Record<string, unknown>) {
  const manualKeys = Object.keys(manual)
  const manualSet = new Set(manualKeys)
  let hit = 0
  for (const s of allStrings) {
    if (manualSet.has(s)) hit += 1
  }
  let onlyManual = 0
  for (const s of manualKeys) {
    if (!allStrings.has(s)) onlyManual += 1
  }
  const dialogueInManual = [...new Set(dialogue.flatMap((b) => [...(b.lines || []), ...(b.choices || [])]))].filter((s) => manualSet.has(s)).length

  return {
    manualExists: true,
    manualCount: manualKeys.length,
    extractedUnique: allStrings.size,
    extractedAlsoInManual: hit,
    extractedNotInManual: allStrings.size - hit,
    manualNotInExtracted: onlyManual,
    dialogueUniqueInManual: dialogueInManual,
    overlapPct: manualKeys.length ? Number(((hit / manualKeys.length) * 100).toFixed(2)) : 0,
    hint: '种子表可能还含插件源码、脚本或图片里的文字；本抽取只读取 data/ 与启用插件参数。',
  }
}
