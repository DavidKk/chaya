# WebRTC 远程串流：后台静默运行与多游戏并发技术方案

- **日期**：2026-10-31
- **状态**：技术方案设计（已就绪）
- **对应需求**：[`../remote-play-silent-multi-instance.md`](../remote-play-silent-multi-instance.md)
- **有效范围**：覆盖 `plugins/mv/src/helpers/game/remote-stream.ts`（音频物理分流与渲染防休眠）、`services/platform/host/osx.ts`（NW.js 无头启动参数）、`services/game/game-process.ts`（多实例生命周期表）以及 `app/api/launch/route.server.ts`（按游戏 ID 路由与进程隔离）。

---

## 1. 模块与调用拓扑

| 文件/模块 | 核心职责 | 变更点概述 |
| :--- | :--- | :--- |
| `plugins/mv/src/helpers/game/remote-stream.ts` | 浏览器内媒体流捕获与 WebAudio 路由 | 将 `_masterGainNode` 与 `ctx.destination` 切断（Mac 静音），仅输出到 WebRTC MediaStream；支持宿主同步发声调试开关 |
| `services/platform/host/osx.ts` | macOS 下拉起 NW.js 宿主进程 | 传入 `--window-hidden` 与 Chromium 防节流参数，禁用前台窗口与后台降频 |
| `services/game/game-process.ts` | 游戏操作系统进程监控与生命周期操作 | 维护 `GameInstanceManager` 实例映射池，支持根据 `gameId`/`contentRoot` 独立启动、查询与精确关闭 |
| `app/api/launch/route.server.ts` | 启动与实例生命周期 HTTP API | 支持接收 `gameId` 与 `mode: "silent" | "windowed"` 入参，不再全局无差别强杀其他游戏进程，实现多实例并发管理 |
| `services/runtime/webrtc-signaling.ts` | 局域网 WebRTC 内存信令交换 | 房间已天然支持 `roomId` 隔离，建立 `game_${gameId}` 对应的独立信令空间 |

---

## 2. 关键技术实现细节

### 2.1 WebAudio 物理声卡断开与 WebRTC 音频独占

RPG Maker MV/MZ 在 `WebAudio` 类中初始化：
```typescript
// 引擎原生实现：
this._context = new (window.AudioContext || window.webkitAudioContext)();
this._masterGainNode = this._context.createGain();
this._masterGainNode.connect(this._context.destination); // 物理扬声器
```

在 `plugins/mv/src/helpers/game/remote-stream.ts` 中拦截：
```typescript
const ctx = g.WebAudio?._context;
const gain = g.WebAudio?._masterGainNode;

if (ctx && gain && typeof ctx.createMediaStreamDestination === "function") {
  // 1. 断开与物理声卡的输出连接（Mac 静音）
  try {
    gain.disconnect(ctx.destination);
  } catch {
    // 兼容部分未直接连接的特殊插件架构
  }

  // 2. 独占接入 WebRTC 音频流（手机端全音质接收）
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  for (const track of dest.stream.getAudioTracks()) {
    stream.addTrack(track);
  }
}
```

### 2.2 无头静默启动与 Chromium 节流禁用

在 `services/platform/host/osx.ts` 中启动 NW.js 时：
```typescript
const silentArgs = [
  path.resolve(contentRoot),
  "--window-hidden",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion",
];
return spawnDetached(binaryPath, silentArgs);
```
配合 `remote-stream.ts` 中已实现的 `ensureGameRenderKeepalive()`（每 40ms 兜底检测渲染帧间隔，必要时直接调用 `SceneManager.renderScene()`），确保在窗口完全不可见或 Mac 锁屏时，底层 Canvas 渲染管线依然稳定维持 60 FPS 输出。

### 2.3 多实例并发隔离与精准销毁

原有的全局清扫模式：
`await terminateAllRunningGameProcesses()`（会把所有游戏不论是谁全都杀掉）。

改造为基于 `gameId` 或 `contentRoot` 的精准管理：
```typescript
export async function terminateGameProcessByRoot(targetRoot: string): Promise<void> {
  const processes = findRunningGameProcesses(targetRoot);
  for (const proc of processes) {
    if (pathEquals(proc.contentRoot, targetRoot)) {
      process.kill(proc.pid, "SIGTERM");
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
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export function registerClientDisconnect(gameId: string) {
  const instance = gameInstances.get(gameId);
  if (!instance) return;
  instance.activeClients = Math.max(0, instance.activeClients - 1);
  if (instance.activeClients === 0) {
    instance.idleTimer = setTimeout(async () => {
      if (instance.activeClients === 0) {
        await terminateGameProcessByRoot(instance.contentRoot);
        gameInstances.delete(gameId);
      }
    }, IDLE_TIMEOUT_MS);
  }
}
```

### 2.6 同款游戏多开演进预留

在架构底层，`instanceId` 预留格式：`${gameId}_${slotId}`。
若未来开启同款游戏多开：
- 为副本创建 `storage/instances/${instanceId}/save` 独立目录；
- NW.js 启动时传入 `--user-data-dir=...` 实现本地存储与存档隔离；
- 当前第一阶段严格维持每个 `gameId` 对应唯一活跃实例，返回 `409 GAME_ALREADY_IN_USE` 独占拦截。
