export type Loose = Record<string, unknown>
export const g = () => globalThis as unknown as Loose

export function call<T>(obj: unknown, name: string, ...args: unknown[]): T | undefined {
  try {
    const fn = (obj as Loose | null | undefined)?.[name]
    return typeof fn === 'function' ? ((fn as (...a: unknown[]) => unknown).apply(obj, args) as T) : undefined
  } catch {
    return undefined
  }
}

export function getBattleScene(): Loose | null {
  const sm = g().SceneManager as Loose | undefined
  const scene = sm?._scene as Loose | undefined
  const battleSceneClass = g().Scene_Battle
  if (!scene) return null
  if (typeof battleSceneClass === 'function' && scene instanceof (battleSceneClass as new () => object)) {
    return scene
  }
  if ((scene.constructor as { name?: string } | undefined)?.name === 'Scene_Battle') {
    return scene
  }
  return null
}
