# WebRTC 远程串流：后台静默运行与多游戏并发技术方案

- **日期**：2026-10-31
- **状态**：技术方案设计（已就绪）
- **对应需求**：[`../remote-play-silent-multi-instance.md`](../remote-play-silent-multi-instance.md)
- **有效范围**：覆盖 `plugins/mv/src/helpers/game/remote-stream.ts`（音频物理分流与渲染防休眠）、`services/platform/host/osx.ts`（NW.js 无头启动参数）、`services/game/game-process.ts`（多实例生命周期表）以及 `app/api/launch/route.server.ts`（按游戏 ID 路由与进程隔离）。

---

## 1. 模块与调用拓扑

| 文件/模块                                      | 核心职责                           | 变更点概述                                                                                                        |
| :--------------------------------------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `plugins/mv/src/helpers/game/remote-stream.ts` | 浏览器内媒体流捕获与 WebAudio 路由 | 将 `_masterGainNode` 与 `ctx.destination` 切断（Mac 静音），仅输出到 WebRTC MediaStream；支持宿主同步发声调试开关 |
| `services/platform/host/osx.ts`                | macOS 下拉起 NW.js 宿主进程        | 传入 `--window-hidden` 与 Chromium 防节流参数，禁用前台窗口与后台降频                                             |
| `services/game/game-process.ts`                | 游戏操作系统进程监控与生命周期操作 | 维护 `GameInstanceManager` 实例映射池，支持根据 `gameId`/`contentRoot` 独立启动、查询与精确关闭                   |
| `app/api/launch/route.server.ts`               | 启动与实例生命周期 HTTP API        | 支持接收 `gameId` 与 `mode: "silent"                                                                              | "windowed"` 入参，不再全局无差别强杀其他游戏进程，实现多实例并发管理 |
| `services/runtime/webrtc-signaling.ts`         | 局域网 WebRTC 内存信令交换         | 房间已天然支持 `roomId` 隔离，建立 `game_${gameId}` 对应的独立信令空间                                            |

---

## 2. 关键技术实现细节

### 2.1 WebAudio 物理声卡断开与 WebRTC 音频独占

RPG Maker MV/MZ 在 `WebAudio` 类中初始化：

```typescript
// 引擎原生实现：
this._context = new (window.AudioContext || window.webkitAudioContext)()
this._masterGainNode = this._context.createGain()
this._masterGainNode.connect(this._context.destination) // 物理扬声器
```

在 `plugins/mv/src/helpers/game/remote-stream.ts` 中拦截：

```typescript
const ctx = g.WebAudio?._context
const gain = g.WebAudio?._masterGainNode

if (ctx && gain && typeof ctx.createMediaStreamDestination === 'function') {
  // 1. 断开与物理声卡的输出连接（Mac 静音）
  try {
    gain.disconnect(ctx.destination)
  } catch {
    // 兼容部分未直接连接的特殊插件架构
  }

  // 2. 独占接入 WebRTC 音频流（手机端全音质接收）
  const dest = ctx.createMediaStreamDestination()
  gain.connect(dest)
  for (const track of dest.stream.getAudioTracks()) {
    stream.addTrack(track)
  }
}
```

### 2.2 无头静默启动与 Chromium 节流禁用

在 `services/platform/host/osx.ts` 中启动 NW.js 时：

```typescript
const silentArgs = [
  path.resolve(contentRoot),
  '--window-hidden',
  '--disable-raf-throttling',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion',
]
return spawnDetached(binaryPath, silentArgs)
```

配合 `remote-stream.ts` 中的 `ensureGameRenderKeepalive()`：优先使用原生动画循环，连续 50ms 没有原生更新时，由 `1000 / 60` ms 的定时器接管。MV 调用 `SceneManager.update()`，但在该次更新期间抑制 `requestUpdate()`，避免每次兜底更新都新增一条 RAF 循环；MZ 调用 PIXI 的 `ticker.update(performance.now())`，同时推进游戏逻辑与画面并保留 ticker 的时间差计算。引擎停止时不再补帧，原生循环恢复后自动停止补帧。

2026-11-01 回归定位到两个问题：旧的 40ms 定时器配合 65ms 阈值无法提供 60 FPS，且 MV 更新会不断新增 RAF 回调；隐藏窗口时的画面捕获还会受到 Chromium 节流影响，因此仅修改定时器或仅增加启动参数都不充分。

同版本 NW.js（v0.119.2 / Chromium 156.0.8078.48）的 1280×720 动画 Canvas 与 WebRTC 回环对照中，旧实现初始隐藏阶段仅解码约 0–2 帧/秒，待执行 RAF 回调在 5 秒内增长至 57 个；恢复窗口后出现约 6,900 次/秒的重复渲染。修复后的最终测试在初始化完成后解码约 51–60 帧/秒，待执行 RAF 回调始终为 1。

随后通过 `/play` 启动完整游戏《Heroines of Swords & Spells II》，确认宿主与渲染进程都带有新的防节流参数。后台隐藏运行、桌面 Chrome 接收标题界面时，约两分钟的 12 个有效性能采样为 55–58 FPS，累计丢帧与丢包均为 0，平均解码耗时为 1–2ms。该验证未载入存档或进入剧情，手机实机与系统锁屏仍需单独验收；系统休眠时也不能保证持续串流。

客户端 HUD 改用 WebRTC `inbound-rtp` 的解码帧数差值计算实际接收帧率，不再使用客户端页面的 RAF 刷新率。每 10 秒记录一次英文视频性能日志，包含帧率、接收码率、丢帧、丢包、抖动与平均解码耗时，用于区分宿主出帧、网络与客户端解码问题。修改启动参数与游戏侧插件后，已有游戏进程需重新启动才能完整应用修复。

### 2.3 多实例并发隔离与精准销毁

原有的全局清扫模式：
`await terminateAllRunningGameProcesses()`（会把所有游戏不论是谁全都杀掉）。

改造为基于 `gameId` 或 `contentRoot` 的精准管理：

```typescript
export async function terminateGameProcessByRoot(targetRoot: string): Promise<void> {
  const processes = findRunningGameProcesses(targetRoot)
  for (const proc of processes) {
    if (pathEquals(proc.contentRoot, targetRoot)) {
      process.kill(proc.pid, 'SIGTERM')
    }
  }
}
```

每个游戏独立分配专属的 `roomId: "game_" + hash(gameRoot)`，信令与媒体流互不干扰。

### 2.4 主动退出协议与优雅存档

当用户在移动端点击【退出游戏】并二次确认后：

1. 客户端通过 WebRTC DataChannel 发送 `{ type: "quit", gameId }`；
2. 插件内调用 `DataManager.saveGame(1)` 或触发当前存档写入；
3. 后端调用 `terminateGameProcessByRoot(contentRoot)` 平稳退出进程；
4. 移动端断开 PeerConnection 并导航返回 `/play` 游戏大厅。

### 2.5 闲置回收定时器（GC）

```typescript
const IDLE_TIMEOUT_MS = 15 * 60 * 1000

export function registerClientDisconnect(gameId: string) {
  const instance = gameInstances.get(gameId)
  if (!instance) return
  instance.activeClients = Math.max(0, instance.activeClients - 1)
  if (instance.activeClients === 0) {
    instance.idleTimer = setTimeout(async () => {
      if (instance.activeClients === 0) {
        await terminateGameProcessByRoot(instance.contentRoot)
        gameInstances.delete(gameId)
      }
    }, IDLE_TIMEOUT_MS)
  }
}
```

### 2.6 同款游戏多开演进预留

在架构底层，`instanceId` 预留格式：`${gameId}_${slotId}`。
若未来开启同款游戏多开：

- 为副本创建 `storage/instances/${instanceId}/save` 独立目录；
- NW.js 启动时传入 `--user-data-dir=...` 实现本地存储与存档隔离；
- 当前第一阶段严格维持每个 `gameId` 对应唯一活跃实例，返回 `409 GAME_ALREADY_IN_USE` 独占拦截。
