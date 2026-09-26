export function collectAllStrings(dialogue: any[], db: Record<string, unknown>) {
  const set = new Set<string>()
  for (const block of dialogue) {
    for (const line of block.lines || []) set.add(line)
    for (const choice of block.choices || []) set.add(choice)
  }
  for (const entries of Object.values(db)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (typeof entry === 'string') {
        set.add(entry)
        continue
      }
      for (const [key, value] of Object.entries(entry)) {
        if (key === 'id') continue
        if (typeof value === 'string') set.add(value)
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
    hint: '种子表通常还含插件/脚本/备注等，本脚本只扫 data/，对不上是正常的。',
  }
}
