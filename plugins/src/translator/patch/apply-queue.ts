/**
 * Catch-up apply after cache HMR.
 * Lookup is already fresh (draw hooks use it immediately); here we only write translations
 * back into the DB / event commands, a small slice per frame so Seed appends do not stall the game thread.
 */

import { type Cmd, dbTables, patchCommand, patchRow, patchSystem, type Translate } from './db-patch'

type Log = { warn: (message: string, meta?: unknown) => void }

const SLICE_BUDGET = 40
const SLICE_GAP_MS = 16

function g(name: string): any {
  return typeof globalThis !== 'undefined' ? (globalThis as any)[name] : undefined
}

export function createTransCatchUp(opts: { translate: Translate; log: Log; preserveDialogue?: boolean }) {
  const { translate, log } = opts
  let busy = false
  let disposed = false
  let again = false
  let phase = 0
  let ti = 0
  let page = 0
  let row = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  function resetCursor() {
    phase = 0
    ti = 0
    page = 0
    row = 0
  }

  function scheduleCatchUp() {
    if (disposed) return
    again = true
    if (busy) return
    busy = true
    again = false
    resetCursor()
    setTimeout(slice, 32)
  }

  /** Redraw open menus so on-screen text tracks the new cache. Skip message windows to avoid interrupting the typewriter. */
  function scheduleWindowRefresh() {
    if (disposed) return
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      try {
        const scene = g('SceneManager')?._scene
        const children = scene?._windowLayer?.children as unknown[] | undefined
        if (!children) return
        const Message = g('Window_Message')
        const Scroll = g('Window_ScrollText')
        for (const child of children) {
          const win = child as { refresh?: () => void }
          if (!win || typeof win.refresh !== 'function') continue
          if (Message && win instanceof Message) continue
          if (Scroll && win instanceof Scroll) continue
          try {
            win.refresh()
          } catch {
            /* One window failure must not block the rest */
          }
        }
      } catch (err) {
        log.warn('窗口刷新失败', err && (err as Error).message ? (err as Error).message : err)
      }
    }, 600)
  }

  function nextEntry() {
    ti += 1
    page = 0
    row = 0
  }

  /** @returns Whether this step consumed budget */
  function stepCommands(entry: any, paged: boolean): boolean {
    if (!entry) {
      nextEntry()
      return false
    }
    if (row === 0 && page === 0 && entry.name) {
      const zh = translate(String(entry.name))
      if (zh !== entry.name) entry.name = zh
    }
    if (!paged) {
      const cmds = entry.list as Cmd[] | undefined
      if (!Array.isArray(cmds) || row >= cmds.length) {
        nextEntry()
        return false
      }
      patchCommand(cmds[row], translate, opts.preserveDialogue)
      row += 1
      return true
    }
    const pages = entry.pages as Array<{ list?: Cmd[] }> | undefined
    if (!Array.isArray(pages) || page >= pages.length) {
      nextEntry()
      return false
    }
    const cmds = pages[page]?.list
    if (!Array.isArray(cmds) || row >= cmds.length) {
      page += 1
      row = 0
      return false
    }
    patchCommand(cmds[row], translate, opts.preserveDialogue)
    row += 1
    return true
  }

  function slice() {
    if (disposed) return
    let used = 0
    let spins = 0
    try {
      while (used < SLICE_BUDGET && phase < 5 && spins < 400) {
        spins += 1
        if (phase === 0) {
          const tables = dbTables()
          if (ti >= tables.length) {
            phase = 1
            ti = 0
            row = 0
            continue
          }
          const table = tables[ti] as Array<Record<string, unknown> | null> | null
          if (!table || row >= table.length) {
            nextEntry()
            continue
          }
          patchRow(table[row], translate)
          row += 1
          used += 1
          continue
        }
        if (phase === 1) {
          const list = g('$dataCommonEvents') as any[] | undefined
          if (!list || ti >= list.length) {
            phase = 2
            ti = 0
            page = 0
            row = 0
            continue
          }
          if (stepCommands(list[ti], false)) used += 1
          continue
        }
        if (phase === 2) {
          const list = g('$dataTroops') as any[] | undefined
          if (!list || ti >= list.length) {
            phase = 3
            ti = 0
            page = 0
            row = 0
            continue
          }
          if (stepCommands(list[ti], true)) used += 1
          continue
        }
        if (phase === 3) {
          patchSystem(translate)
          phase = 4
          ti = 0
          page = 0
          row = 0
          used += 1
          continue
        }
        const map = g('$dataMap')
        if (!map || !Array.isArray(map.events)) {
          phase = 5
          continue
        }
        if (ti === 0 && page === 0 && row === 0 && map.displayName) {
          const zh = translate(String(map.displayName))
          if (zh !== map.displayName) map.displayName = zh
        }
        if (ti >= map.events.length) {
          phase = 5
          continue
        }
        if (stepCommands(map.events[ti], true)) used += 1
      }
    } catch (err) {
      log.warn('分片套用中断', err && (err as Error).message ? (err as Error).message : err)
      phase = 5
    }
    if (phase < 5) {
      setTimeout(slice, SLICE_GAP_MS)
      return
    }
    busy = false
    if (again) scheduleCatchUp()
  }

  return {
    scheduleCatchUp,
    scheduleWindowRefresh,
    dispose: () => {
      disposed = true
      if (refreshTimer) clearTimeout(refreshTimer)
    },
  }
}
