import { installRequireProtection } from '@/lib/runtime/require-protection'

describe('require-protection', () => {
  it('safely proxies Node require and intercepts AMD loader reassignment', () => {
    const nodeModules: Record<string, unknown> = {
      path: { normalize: (p: string) => p.replace(/\\/g, '/'), isPath: true },
      fs: { readFileSync: () => 'content', isFs: true },
    }

    const mockNodeRequire = jest.fn((id: string) => {
      if (nodeModules[id]) return nodeModules[id]
      throw new Error(`Cannot find module '${id}'`)
    })
    ;(mockNodeRequire as any).resolve = jest.fn(() => '/path/to/module')

    const targetWindow: Record<string, any> = {
      require: mockNodeRequire,
    }

    // 1. Install protection
    installRequireProtection(targetWindow)

    // Verify Node require works normally
    expect(targetWindow.require('path')).toEqual(nodeModules.path)
    expect(mockNodeRequire).toHaveBeenCalledWith('path')

    // 2. Simulate Monaco vs/loader.js overwriting window.require with an AMD function
    const amdConfigFn = jest.fn()
    const amdLoadFn = jest.fn()
    const mockAmdRequire: any = jest.fn((deps: any, cb: any) => {
      if (Array.isArray(deps)) {
        amdLoadFn(deps, cb)
      } else if (typeof deps === 'string') {
        throw new Error(`Check dependency list! Synchronous require cannot resolve module '${deps}'.`)
      }
    })
    mockAmdRequire.config = amdConfigFn

    // Monaco does: window.require = r
    targetWindow.require = mockAmdRequire

    // 3. Verify Node module calls like require('path') still route to Node require!
    const pathResult = targetWindow.require('path')
    expect(pathResult).toEqual(nodeModules.path)
    expect(mockAmdRequire).not.toHaveBeenCalledWith('path')

    // 4. Verify AMD configuration and array require still route to AMD loader!
    targetWindow.require.config({ paths: { vs: 'https://cdn...' } })
    expect(amdConfigFn).toHaveBeenCalledWith({ paths: { vs: 'https://cdn...' } })

    const callback = jest.fn()
    targetWindow.require(['vs/editor/editor.main'], callback)
    expect(amdLoadFn).toHaveBeenCalledWith(['vs/editor/editor.main'], callback)

    // 5. Verify Node require properties (like resolve) remain accessible
    expect(targetWindow.require.resolve).toBeDefined()
  })
})
