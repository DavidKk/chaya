import type { HostShellCapability } from './types'

/** edge 无本机文件管理器 / 壳启动 */
export class EdgeHostShell implements HostShellCapability {
  readonly id = 'hostShell' as const

  reveal(_targetPath: string): Promise<void> {
    return Promise.reject(new Error('当前服务形态不支持本机文件管理器'))
  }

  open(_targetPath: string): Promise<void> {
    return Promise.reject(new Error('当前服务形态不支持本机打开路径'))
  }

  launchShell(_shellApp: string, _contentRoot: string): Promise<void> {
    return Promise.reject(new Error('当前服务形态不支持启动游戏壳'))
  }
}
