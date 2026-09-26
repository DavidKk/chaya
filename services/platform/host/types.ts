/** 文件管理器 / 壳启动：同一能力，按 OS × lane 换实现 */
export interface HostShellCapability {
  readonly id: 'hostShell'
  reveal(targetPath: string): Promise<void>
  open(targetPath: string): Promise<void>
  launchShell(shellApp: string, contentRoot: string): Promise<void>
}
