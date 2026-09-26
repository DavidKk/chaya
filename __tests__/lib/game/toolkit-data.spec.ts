import path from 'node:path'

import { describe, expect, it } from '@jest/globals'

import { SHELL_APP_NAME, SHELL_WIN_DIR_NAME } from '@/constants/brand'
import { toolkitShellFolderName } from '@/lib/game/shell-layout'
import { toolkitShellAppPath, toolkitShellDir } from '@/lib/game/toolkit-data'

describe('toolkitShellAppPath', () => {
  it('mac 布局落在 data/shell/{SHELL_APP_NAME}', () => {
    const root = '/tmp/fake-toolkit'
    expect(toolkitShellDir(root)).toBe(path.join(root, 'data', 'shell'))
    expect(toolkitShellAppPath(root, 'darwin')).toBe(path.join(root, 'data', 'shell', SHELL_APP_NAME))
  })

  it('win 布局落在 data/shell/{SHELL_WIN_DIR_NAME}', () => {
    const root = '/tmp/fake-toolkit'
    expect(toolkitShellFolderName('win32')).toBe(SHELL_WIN_DIR_NAME)
    expect(toolkitShellAppPath(root, 'win32')).toBe(path.join(root, 'data', 'shell', SHELL_WIN_DIR_NAME))
  })
})
