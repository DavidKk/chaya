/**
 * 解析导入文件：JSON 对象 { src: zh }，或与本作一致的 NDJSON（[src,zh] / {s,t}）。
 */
export function parseTranslateImportText(text: string): {
  map: Record<string, string>
  skipped: number
  format: 'json' | 'ndjson'
} {
  const rawText = String(text ?? '')
  const trimmed = rawText.trim()
  if (!trimmed) return { map: Object.create(null), skipped: 0, format: 'json' }

  if (trimmed.startsWith('{')) {
    try {
      const raw = JSON.parse(trimmed) as unknown
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const map: Record<string, string> = Object.create(null)
        let skipped = 0
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (v == null || v === '') {
            skipped += 1
            continue
          }
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            map[String(k)] = String(v)
          } else {
            skipped += 1
          }
        }
        return { map, skipped, format: 'json' }
      }
    } catch {
      /* 非整包 JSON 时按 ndjson 行解析 */
    }
  }

  const map: Record<string, string> = Object.create(null)
  let skipped = 0
  for (const line of rawText.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as unknown
      if (Array.isArray(row) && row.length >= 2 && row[0] != null && row[1] != null) {
        map[String(row[0])] = String(row[1])
      } else if (row && typeof row === 'object') {
        const rec = row as { s?: unknown; t?: unknown }
        if (rec.s != null && rec.t != null) map[String(rec.s)] = String(rec.t)
        else skipped += 1
      } else {
        skipped += 1
      }
    } catch {
      skipped += 1
    }
  }
  return { map, skipped, format: 'ndjson' }
}
