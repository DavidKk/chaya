/**
 * Protects Node.js `require` in NW.js / Electron environments from being overwritten
 * by AMD module loaders such as Monaco Editor (`vs/loader.js`).
 *
 * In RPG Maker MV (NW.js), game engines and localization plugins (like DKTools) rely
 * on `require('path')`, `require('fs')`, etc. When Monaco's AMD loader loads, it reassigns
 * `window.require` to its own AMD function, which throws:
 * "Check dependency list! Synchronous require cannot resolve module 'path'."
 *
 * This transparent proxy ensures:
 * 1. String calls (e.g. `require('path')`, `require('fs')`) delegate to Node's native require.
 * 2. AMD calls (e.g. `require(['vs/editor/...'], callback)`) route to Monaco's AMD loader.
 * 3. AMD properties (`require.config`, etc.) and Node properties (`require.resolve`, etc.)
 *    remain seamlessly available.
 */
export function installRequireProtection(target?: Record<string, unknown>): void {
  if (!target) {
    const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null
    const glob = typeof global !== 'undefined' ? (global as unknown as Record<string, unknown>) : null
    const gt = typeof globalThis !== 'undefined' ? (globalThis as unknown as Record<string, unknown>) : null
    if (win) installRequireProtection(win)
    if (glob && glob !== win) installRequireProtection(glob)
    if (gt && gt !== win && gt !== glob) installRequireProtection(gt)
    return
  }
  if (!target || typeof target !== 'object') return
  const currentRequire = target.require
  const glob = globalThis as { nw?: { require?: NodeRequire }; process?: { mainModule?: { require?: NodeRequire } } }
  const nodeCandidate =
    (target.nodeRequire as ((...args: unknown[]) => unknown) & Record<string, unknown>) ||
    (typeof currentRequire === 'function' ? (currentRequire as ((...args: unknown[]) => unknown) & Record<string, unknown>) : null) ||
    (glob.nw?.require as unknown as ((...args: unknown[]) => unknown) & Record<string, unknown>) ||
    (glob.process?.mainModule?.require as unknown as ((...args: unknown[]) => unknown) & Record<string, unknown>)
  if (!nodeCandidate || typeof nodeCandidate !== 'function') return
  if (currentRequire && (currentRequire as { __isChayaProtectedRequire?: boolean }).__isChayaProtectedRequire) return

  let currentAmdRequire: (((...args: unknown[]) => unknown) & Record<string, unknown>) | null = null
  const originalNodeRequire = nodeCandidate

  const hybridRequire = function (firstArg: unknown, ...rest: unknown[]): unknown {
    // 1. AMD calls: require(['vs/...'], callback, errorCallback)
    if (Array.isArray(firstArg)) {
      if (currentAmdRequire) return currentAmdRequire(firstArg, ...rest)
    }

    // 2. Node.js module calls: require('path'), require('fs'), require('nw.gui')
    if (typeof firstArg === 'string') {
      try {
        return originalNodeRequire(firstArg, ...rest)
      } catch (nodeErr) {
        // Fallback to AMD only if Node.js cannot find the module and not a core node module
        if (
          currentAmdRequire &&
          !['path', 'fs', 'os', 'crypto', 'buffer', 'stream', 'util', 'events', 'child_process', 'http', 'https', 'net', 'url', 'zlib', 'nw.gui'].includes(firstArg)
        ) {
          try {
            return currentAmdRequire(firstArg, ...rest)
          } catch {
            // Ignore AMD error and throw original nodeErr
          }
        }
        throw nodeErr
      }
    }

    // 3. Fallbacks
    if (currentAmdRequire) return currentAmdRequire(firstArg, ...rest)
    return originalNodeRequire(firstArg, ...rest)
  }

  ;(hybridRequire as { __isChayaProtectedRequire?: boolean }).__isChayaProtectedRequire = true

  const proxyRequire = new Proxy(hybridRequire, {
    get(t, prop, receiver) {
      if (prop in t) return Reflect.get(t, prop, receiver)
      if (currentAmdRequire && prop in currentAmdRequire) return currentAmdRequire[prop as string]
      if (originalNodeRequire && prop in originalNodeRequire) return originalNodeRequire[prop as string]
      return undefined
    },
    set(t, prop, value) {
      if (currentAmdRequire) currentAmdRequire[prop as string] = value
      if (originalNodeRequire) {
        try {
          originalNodeRequire[prop as string] = value
        } catch {
          // ignore read-only properties
        }
      }
      return Reflect.set(t, prop, value)
    },
    has(t, prop) {
      return prop in t || (currentAmdRequire != null && prop in currentAmdRequire) || (originalNodeRequire != null && prop in originalNodeRequire)
    },
  })

  if (!target.nodeRequire) {
    target.nodeRequire = originalNodeRequire
  }

  try {
    Object.defineProperty(target, 'require', {
      configurable: true,
      enumerable: true,
      get() {
        return proxyRequire
      },
      set(val: ((...args: unknown[]) => unknown) & Record<string, unknown>) {
        if (val !== proxyRequire) {
          currentAmdRequire = val
        }
      },
    })
  } catch {
    target.require = proxyRequire
  }
}

installRequireProtection()
