/**
 * 平台能力入口。
 * 每个能力目录的 `index.ts` 用对照表写清 OS × lane；门面只调 `resolveXxx()`。
 * `lib/platform`：环境判定；可选 `PlatformRegistry`（当前未强制使用）。
 */
export { HOST_SHELL_CAPABILITY, type HostShellCapability, resolveHostShell } from './host'
export { PICK_PATH_CAPABILITY, type PickPathCapability, resolvePickPath } from './pick'
