import type { LibraryItemView } from '@/lib/game/types'

import type { CloudGame } from './cloud-prepare-game'

export type CloudLibraryEntry = { item: LibraryItemView; game: CloudGame }

/** Directory handles are structured-cloned by IndexedDB; game files are never copied. */
export async function cloudLibraryStorage(entries?: CloudLibraryEntry[]): Promise<CloudLibraryEntry[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chaya-browser-library', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('library')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('library', entries ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('library')
      const request = entries ? store.put(entries, 'entries') : store.get('entries')
      let result: CloudLibraryEntry[] = []
      request.onsuccess = () => {
        result = entries ?? request.result ?? []
      }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('保存游戏库失败'))
    })
  } finally {
    db.close()
  }
}

export async function requireCloudPermission(game: CloudGame): Promise<void> {
  const handle = game.picked as FileSystemDirectoryHandle & {
    requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  }
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('需要授权访问游戏目录，请重新点击操作或添加游戏。')
}

type QueryableHandle = FileSystemDirectoryHandle & { queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState> }

/** Silent work (no click) is only allowed when this returns true; it never prompts */
export function canQueryCloudPermission(game: CloudGame): boolean {
  return typeof (game.picked as QueryableHandle).queryPermission === 'function'
}

export async function hasCloudPermission(game: CloudGame): Promise<boolean> {
  const handle = game.picked as QueryableHandle
  if (typeof handle.queryPermission !== 'function') return false
  return (await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted'
}

/** Library rewritten outside the dashboard (WebMCP tools): the dashboard reloads from IndexedDB */
export const CLOUD_LIBRARY_CHANGED_EVENT = 'chaya:browser-library-changed'

const ACTIVE_GAME_KEY = 'chaya.browserActiveGame'
export const CLOUD_GAME_SELECTION_EVENT = 'chaya:browser-game-selected'
export function readCloudGameId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_GAME_KEY) || null
  } catch {
    return null
  }
}
export function selectCloudGameId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_GAME_KEY, id)
  else localStorage.removeItem(ACTIVE_GAME_KEY)
  window.dispatchEvent(new Event(CLOUD_GAME_SELECTION_EVENT))
}
