import type { AlignmentGroup } from '@/lib/translate/sentence-plan'

/** Parse translation JSON objects mapping source to target, or game-compatible NDJSON rows using arrays or s/t objects. */
export function parseTranslateImportText(text: string): {
  map: Record<string, string>
  skipped: number
  format: 'json' | 'ndjson'
  alignments?: Array<{ src: string; groups: AlignmentGroup[] }>
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
        const alignments: Array<{ src: string; groups: AlignmentGroup[] }> = []
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (v == null || v === '') {
            skipped += 1
            continue
          }
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            map[String(k)] = String(v)
          } else if (v && typeof v === 'object' && typeof (v as { t?: unknown }).t === 'string') {
            const item = v as { t: string; alignments?: AlignmentGroup[] }
            map[k] = item.t
            if (Array.isArray(item.alignments)) alignments.push({ src: k, groups: item.alignments })
          } else {
            skipped += 1
          }
        }
        return { map, skipped, format: 'json', ...(alignments.length ? { alignments } : {}) }
      }
    } catch {
      /* 非整包 JSON 时按 ndjson 行解析 */
    }
  }

  const map: Record<string, string> = Object.create(null)
  let skipped = 0
  const alignments: Array<{ src: string; groups: AlignmentGroup[] }> = []
  for (const line of rawText.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as unknown
      if (Array.isArray(row) && row.length >= 2 && row[0] != null && row[1] != null) {
        map[String(row[0])] = String(row[1])
      } else if (row && typeof row === 'object') {
        const rec = row as { s?: unknown; t?: unknown; alignments?: AlignmentGroup[] }
        if (rec.s != null && rec.t != null) {
          map[String(rec.s)] = String(rec.t)
          if (Array.isArray(rec.alignments)) alignments.push({ src: String(rec.s), groups: rec.alignments })
        } else skipped += 1
      } else {
        skipped += 1
      }
    } catch {
      skipped += 1
    }
  }
  return { map, skipped, format: 'ndjson', ...(alignments.length ? { alignments } : {}) }
}
