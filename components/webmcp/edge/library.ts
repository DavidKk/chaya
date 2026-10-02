import { CLOUD_LIBRARY_CHANGED_EVENT, type CloudLibraryEntry, cloudLibraryStorage, readCloudGameId, selectCloudGameId } from '@/lib/browser/cloud-library'
import type { CloudGame } from '@/lib/browser/cloud-prepare-game'
import { includesText, optStr, reqStr } from '@/lib/integration/tools/args'
import type { ToolImpls } from '@/lib/integration/tools/types'
import { webMcpCodedError } from '@/lib/webmcp/mcp-mirror'

export async function activeCloudEntry(): Promise<{ entries: CloudLibraryEntry[]; active: CloudLibraryEntry | undefined }> {
  const entries = await cloudLibraryStorage()
  const id = readCloudGameId()
  return { entries, active: entries.find((entry) => entry.item.id === id) ?? entries[0] }
}

export async function requireActiveGame(): Promise<CloudLibraryEntry> {
  const { active } = await activeCloudEntry()
  if (!active) throw webMcpCodedError('no_game', '浏览器游戏库为空：请用户在游戏库页面点击「添加游戏」选择目录')
  return active
}

/** Never prompts: directory permission needs a user gesture, so agents only use an already granted handle. */
export async function ensureDirPermission(game: CloudGame, mode: 'read' | 'readwrite'): Promise<void> {
  const handle = game.picked as FileSystemDirectoryHandle & { queryPermission?: (options: { mode: 'read' | 'readwrite' }) => Promise<PermissionState> }
  const state = (await handle.queryPermission?.({ mode })) ?? 'prompt'
  if (state !== 'granted') {
    throw webMcpCodedError('permission_required', `浏览器尚未授权${mode === 'read' ? '读取' : '写入'}游戏目录：请用户在游戏库页面点一次相关操作完成授权后再试`)
  }
}

export async function saveEntries(entries: CloudLibraryEntry[]) {
  await cloudLibraryStorage(entries)
  window.dispatchEvent(new Event(CLOUD_LIBRARY_CHANGED_EVENT))
}

function findEntry(entries: CloudLibraryEntry[], key: string): CloudLibraryEntry {
  const hit = entries.find((entry) => entry.item.gameRoot === key || entry.item.id === key)
  if (!hit) throw new Error(`游戏库中未找到：${key}（用 chaya_library_list 返回的 gameRoot）`)
  return hit
}

function gameView(entry: CloudLibraryEntry) {
  const { item } = entry
  return {
    gameRoot: item.gameRoot,
    name: item.name,
    remark: item.remark ?? null,
    kind: item.kindLabel,
    missing: item.missing,
    remote: false,
    hasShell: item.hasShell,
    lastOpenedAt: item.lastOpenedAt,
  }
}

/** `chaya_library_*` over the browser (IndexedDB) library; adding games needs the user's directory picker. */
export const edgeLibraryTools: ToolImpls = {
  async chaya_library_list(args) {
    const { entries, active } = await activeCloudEntry()
    const q = optStr(args, 'q')?.toLowerCase()
    const games = q ? entries.filter(({ item }) => includesText(item.name, q) || includesText(item.remark, q) || includesText(item.gameRoot, q)) : entries
    return { serviceMode: 'vercel', current: active?.item.gameRoot ?? null, total: entries.length, matched: games.length, games: games.map(gameView) }
  },

  async chaya_library_bind(args) {
    const { entries, active } = await activeCloudEntry()
    const entry = findEntry(entries, reqStr(args, 'gameRoot'))
    const unchanged = entry === active
    await saveEntries(entries.map((e) => (e === entry ? { ...e, item: { ...e.item, lastOpenedAt: Date.now() } } : e)))
    selectCloudGameId(entry.item.id)
    return { current: entry.item.gameRoot, unchanged, hint: '网页版只能切换库中已有游戏；添加新游戏需用户在游戏库页面选择目录' }
  },

  async chaya_library_remark(args) {
    const { entries } = await activeCloudEntry()
    const entry = findEntry(entries, reqStr(args, 'gameRoot'))
    const remark = typeof args.remark === 'string' && args.remark.trim() ? args.remark.trim() : undefined
    await saveEntries(entries.map((e) => (e === entry ? { ...e, item: { ...e.item, remark } } : e)))
    return { gameRoot: entry.item.gameRoot, remark: remark ?? null }
  },

  async chaya_library_remove(args) {
    const { entries, active } = await activeCloudEntry()
    const entry = findEntry(entries, reqStr(args, 'gameRoot'))
    const next = entries.filter((e) => e !== entry)
    await saveEntries(next)
    if (entry === active) selectCloudGameId(next[0]?.item.id ?? null)
    return { removed: entry.item.gameRoot, current: (entry === active ? next[0] : active)?.item.gameRoot ?? null, total: next.length }
  },
}
