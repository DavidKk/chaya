import path from 'node:path'

import { resolveShellLaunchTarget } from '@/lib/game/shell-layout'

import { assertPathExists, spawnDetached } from './shared'
import type { HostShellCapability } from './types'

/**
 * Linux：用 xdg-open / 直接 spawn nw；不再误用 macOS `open`。
 */
export class LinuxHostShell implements HostShellCapability {
  readonly id = 'hostShell' as const

  reveal(targetPath: string): Promise<void> {
    assertPathExists(targetPath)
    const abs = path.resolve(targetPath)
    // 多数文件管理器无统一「选中」API：打开所在目录
    const dir = path.dirname(abs)
    return spawnDetached('xdg-open', [dir])
  }

  open(targetPath: string): Promise<void> {
    assertPathExists(targetPath)
    return spawnDetached('xdg-open', [path.resolve(targetPath)])
  }

  launchShell(shellApp: string, contentRoot: string): Promise<void> {
    assertPathExists(shellApp)
    assertPathExists(contentRoot)
    const bin = resolveShellLaunchTarget(shellApp)
    return spawnDetached(bin, [path.resolve(contentRoot)], { cwd: path.dirname(bin) })
  }
}
