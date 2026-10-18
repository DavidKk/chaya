import { optStr } from './args'
import type { AgentCaller } from './live'
import type { ToolImpls } from './types'

/** The save snapshot's `enabled` flag is the auto-save timer, not the result. Return only the entry that was just written. */
function summarizeSave(value: unknown) {
  const entries = (value as { index?: { entries?: { id?: unknown; list?: unknown; tag?: unknown; savedAt?: unknown; mapName?: unknown; unsafe?: unknown }[] } } | null)?.index
    ?.entries
  if (!Array.isArray(entries) || !entries.length) return { ok: true, saved: null }
  const newest = entries.reduce((best, entry) => (Number(entry.savedAt) > Number(best.savedAt) ? entry : best))
  return {
    ok: true,
    saved: {
      id: newest.id,
      list: newest.list,
      tag: newest.tag,
      savedAt: newest.savedAt,
      mapName: typeof newest.mapName === 'string' ? newest.mapName : '',
      unsafe: newest.unsafe === true,
    },
    where: newest.list === 'quick' || newest.list === 'auto' ? 'Chaya save list (does not appear in native game save menu)' : 'Native game save',
  }
}

/** Agent-facing access to Chaya's automatic and quick-save store. */
export function makeSaveTools(call: AgentCaller): ToolImpls {
  return {
    async chaya_live_saves(args) {
      return call(optStr(args, 'gameId'), 'game.saves', { op: 'snapshot' })
    },
    async chaya_live_saves_load(args) {
      const entryId = optStr(args, 'entryId')
      if (!entryId) throw new Error('Missing parameter entryId')
      return call(optStr(args, 'gameId'), 'game.saves', { op: 'load', entryId, allowVersionMismatch: args.allowVersionMismatch === true })
    },
    async chaya_live_save(args) {
      // Native game saves are the player-visible default. Chaya quick/auto saves
      // must be explicitly requested so an omitted model argument cannot hide progress.
      const source = optStr(args, 'source') || 'native'
      const slot = args.slot === undefined ? (source === 'native' ? 1 : undefined) : Number(args.slot)
      if (source === 'native') {
        if (slot === undefined || !Number.isInteger(slot) || slot < 1) throw new Error('native save requires positive integer slot')
        const nativeSlot = slot
        return call(optStr(args, 'gameId'), 'game.saves', { op: 'nativeSave', slot: nativeSlot })
      }
      if (source === 'quick') {
        if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot > 9) throw new Error('quick save requires slot between 0 and 9')
        const quickSlot = slot
        return summarizeSave(await call(optStr(args, 'gameId'), 'game.saves', { op: 'quickSave', slot: quickSlot, force: args.force === true }))
      }
      if (source === 'auto') return summarizeSave(await call(optStr(args, 'gameId'), 'game.saves', { op: 'autoSave', force: args.force === true }))
      throw new Error('source must be native, quick, or auto')
    },
    async chaya_live_load_save(args) {
      const source = optStr(args, 'source') || 'native'
      const slot = args.slot === undefined ? (source === 'native' ? 1 : undefined) : Number(args.slot)
      if (source === 'native') {
        if (slot === undefined || !Number.isInteger(slot) || slot < 1) throw new Error('native load requires positive integer slot')
        const nativeSlot = slot
        return call(optStr(args, 'gameId'), 'game.saves', { op: 'nativeLoad', slot: nativeSlot })
      }
      if (source === 'quick') {
        if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot > 9) throw new Error('quick load requires slot between 0 and 9')
        const quickSlot = slot
        return call(optStr(args, 'gameId'), 'game.saves', { op: 'load', entryId: `quick-${quickSlot}`, allowVersionMismatch: args.allowVersionMismatch === true })
      }
      if (source === 'auto') {
        const entryId = optStr(args, 'entryId')
        if (!entryId) throw new Error('auto load requires entryId')
        return call(optStr(args, 'gameId'), 'game.saves', { op: 'load', entryId, allowVersionMismatch: args.allowVersionMismatch === true })
      }
      throw new Error('source must be native, quick, or auto')
    },
  }
}
