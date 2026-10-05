import type { EventCommand } from './types'

const num = (value: unknown) => Math.floor(Number(value) || 0)

export function normalizeCommands(list: unknown): EventCommand[] {
  if (!Array.isArray(list)) return []
  const out: EventCommand[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    out.push({ code: num(rec.code), indent: num(rec.indent), parameters: Array.isArray(rec.parameters) ? rec.parameters : [] })
  }
  return out
}

export function countCommands(list: readonly EventCommand[]): number {
  let n = 0
  for (const cmd of list) if (cmd.code !== 0) n++
  return n
}

/** Dialogue, scrolling text, choices and MZ speaker names to look up translations for */
export function collectTexts(list: readonly EventCommand[], into: Set<string>) {
  for (const cmd of list) {
    const p = cmd.parameters
    if ((cmd.code === 401 || cmd.code === 405) && typeof p[0] === 'string') into.add(p[0])
    else if (cmd.code === 101 && typeof p[4] === 'string' && p[4]) into.add(p[4])
    else if (cmd.code === 102 && Array.isArray(p[0])) {
      for (const choice of p[0]) if (typeof choice === 'string') into.add(choice)
    } else if (cmd.code === 402 && typeof p[1] === 'string') into.add(p[1])
  }
}

export function translatedTexts(sources: Iterable<string>, tr: (text: string) => string): Record<string, string> {
  const texts: Record<string, string> = {}
  for (const src of sources) {
    const out = tr(src)
    if (out && out !== src) texts[src] = out
  }
  return texts
}
