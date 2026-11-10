export function isCancelError(msg: string): boolean {
  return /User canceled|(-128)/i.test(msg) || /\bcancel(l?ed)\b/i.test(msg) || /exit code [12]\b/i.test(msg)
}

export function normalizeSelected(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\r\n]+/g, '')
    .replace(/[\\/]+$/, '')
}

/** One absolute path per line. Blank lines are ignored; the first path stays `path` for single-select callers. */
export function splitPickedPaths(raw: string): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const line of String(raw || '').split(/\r?\n/)) {
    const selected = normalizeSelected(line)
    if (!selected || seen.has(selected)) continue
    seen.add(selected)
    paths.push(selected)
  }
  return paths
}

export function pickedPaths(raw: string): { path: string; paths: string[] } | null {
  const paths = splitPickedPaths(raw)
  const path = paths[0]
  return path ? { path, paths } : null
}

export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
