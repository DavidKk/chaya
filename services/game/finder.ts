/**
 * 文件管理器 / 壳启动。
 * 分发：`services/platform/host/index.ts` 对照表；
 * 实现：`host/osx.ts` | `windows.ts` | `linux.ts` | `edge.ts`。
 */
import { resolveHostShell } from '@/services/platform'

export function revealInFinder(targetPath: string): Promise<void> {
  return resolveHostShell().reveal(targetPath)
}

export function openInFinder(targetPath: string): Promise<void> {
  return resolveHostShell().open(targetPath)
}

export function launchShellWithContent(shellApp: string, contentRoot: string): Promise<void> {
  return resolveHostShell().launchShell(shellApp, contentRoot)
}
