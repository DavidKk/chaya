/** Stable numeric ids for runtime objects; ids never repeat within a session and don't keep objects alive */
const ids = new WeakMap<object, number>()
let next = 1

export function oidOf(obj: object): number {
  let id = ids.get(obj)
  if (id == null) {
    id = next++
    ids.set(obj, id)
  }
  return id
}
