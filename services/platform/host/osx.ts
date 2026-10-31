import path from 'node:path'

import { findNwMacBinary } from '@/lib/game/shell-layout'

import { assertPathExists, spawnDetached } from './shared'
import type { HostShellCapability, LaunchShellOptions } from './types'

export class OsxHostShell implements HostShellCapability {
  readonly id = 'hostShell' as const

  reveal(targetPath: string): Promise<void> {
    assertPathExists(targetPath)
    return spawnDetached('open', ['-R', targetPath])
  }

  open(targetPath: string): Promise<void> {
    assertPathExists(targetPath)
    return spawnDetached('open', [targetPath])
  }

  launchShell(shellApp: string, contentRoot: string, options?: LaunchShellOptions): Promise<void> {
    assertPathExists(shellApp)
    assertPathExists(contentRoot)
    findNwMacBinary(shellApp)
    const args = ['-n', shellApp, '--args', path.resolve(contentRoot)]
    if (options?.silent) {
      args.push(
        '--window-hidden',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion'
      )
    }
    if (options?.extraArgs?.length) {
      args.push(...options.extraArgs)
    }
    return spawnDetached('open', args)
  }
}
