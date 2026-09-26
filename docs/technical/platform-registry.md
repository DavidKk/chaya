# 平台能力分发（一眼对照）

> 核心目标：**打开某个能力目录，立刻知道各 OS / lane 怎么处理**，而不是在一堆 `if (win32)` 里跳读。  
> 注册器是可选工具，不是必需。相关：[service-modes.md](./service-modes.md)

## 1. 怎么组织才「一眼」

推荐形态（已用于 `pickPath` / `hostShell`）：

```text
services/platform/<capability>/
  index.ts      ← 对照表 + resolveXxx()   ← 先看这里
  types.ts      ← 接口（这件事做什么）
  osx.ts        ← 仅 macOS
  windows.ts
  linux.ts
  edge.ts       ← vercel / 无盘
  shared.ts     ← 可选共用小工具
```

`index.ts` 顶部用注释表 + `Record<HostOs, Impl>` 写死映射，例如：

```ts
const localByOs = {
  osx: new OsxPickPath(),
  windows: new WindowsPickPath(),
  linux: new LinuxPickPath(),
}
```

改 Windows 行为 → 只开 `windows.ts`；改云端不可用文案 → 只开 `edge.ts`。

域门面保持薄：[`picker.ts`](../../services/game/picker.ts) / [`finder.ts`](../../services/game/finder.ts) 只调 `resolvePickPath()` / `resolveHostShell()`。

## 2. 二维环境

| 维              | 取值                        | 来源                                    |
| --------------- | --------------------------- | --------------------------------------- |
| **HostOs**      | `windows` / `linux` / `osx` | `process.platform`                      |
| **RuntimeLane** | `local` / `edge`            | `local`\|`app` → local；`vercel` → edge |

判定：[`lib/platform/env.ts`](../../lib/platform/env.ts)。`app` 与 `local` 共用 local 实现。

## 3. 可选：PlatformRegistry

[`lib/platform/registry.ts`](../../lib/platform/registry.ts) 提供通用 `register` / `resolve`（含 `*` 通配）。  
**当前能力不用它**——对照表更直观。以后若有插件式动态挂载再启用即可。

## 4. 已拆能力

| 能力                        | 目录                      | 门面                      |
| --------------------------- | ------------------------- | ------------------------- |
| 原生选路径                  | `services/platform/pick/` | `services/game/picker.ts` |
| reveal / open / launchShell | `services/platform/host/` | `services/game/finder.ts` |

后续同模式：`installShell`、`resolveGame` 策略等——**先保证目录一眼可读，再谈接线方式**。

## 5. 约定

1. 能力确认「做什么」；平台文件确认「怎么做」。
2. 禁止在域业务里再堆长大的 `process.platform` 分支。
3. edge 不平行实现 DiskOps；与 `requireDisk` 双保险。
4. 怎么接线都行（对照表 / 简单 switch / 注册器），以可读为先。
