/** A stamp change is safe only when every edge came from this session's own append. */
export function followsOwnedStampChain(from: string, to: string, transitions: ReadonlyMap<string, string>): boolean {
  let current = from
  const seen = new Set<string>()
  while (current !== to) {
    if (seen.has(current)) return false
    seen.add(current)
    const next = transitions.get(current)
    if (!next) return false
    current = next
  }
  return true
}
