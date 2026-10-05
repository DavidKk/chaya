import path from 'node:path'

import { findNwMacBinary } from '@/lib/game/shell-layout'

import { assertPathExists, spawnDetached } from './shared'
import type { HostShellCapability } from './types'

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

  launchShell(shellApp: string, contentRoot: string): Promise<void> {
    assertPathExists(shellApp)
    assertPathExists(contentRoot)
    findNwMacBinary(shellApp)
    return spawnDetached('open', ['-n', shellApp, '--args', path.resolve(contentRoot)])
  }
}
