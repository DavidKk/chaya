import type { HostShellCapability } from './types'

/** remote 无本机文件管理器 / 壳启动 */
export class RemoteHostShell implements HostShellCapability {
  readonly id = 'hostShell' as const

  reveal(_targetPath: string): Promise<void> {
    return Promise.reject(new Error('Local file manager is not supported in current service mode'))
  }

  open(_targetPath: string): Promise<void> {
    return Promise.reject(new Error('Opening local path is not supported in current service mode'))
  }

  launchShell(_shellApp: string, _contentRoot: string): Promise<void> {
    return Promise.reject(new Error('Launching game shell is not supported in current service mode'))
  }
}
