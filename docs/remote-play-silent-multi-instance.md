# WebRTC 远程串流：后台静默运行与多游戏并发需求文档

- **日期**：2026-10-31
- **状态**：需求终稿（已评审就绪，可开始实施）
- **对应技术方案**：[technical/remote-play-silent-multi-instance.md](technical/remote-play-silent-multi-instance.md)
- **关联文档**：[run-modes.md](run-modes.md)（运行模式与服务形态）、[requirements-service-modes.md](requirements-service-modes.md)（能力边界）、[rgss-webview-overlay.md](rgss-webview-overlay.md)（WebRTC 串流基线）
- **有效范围**：覆盖 Chaya 本地 NW.js（RPG Maker MV/MZ）静默后台生命周期管理、WebAudio 物理隔离分流、以及基于 WebRTC Signaling 房间的多游戏多客户端并发游玩架构。后续 RGSS（XP / VX / VX Ace）无头虚拟化在单独阶段规划。

---

## 1. 背景与核心痛点

Chaya 现已支持基于 WebRTC 的局域网低延迟音画串流，移动端（iOS / Android / iPad）可通过 Safari 浏览器或 PWA 主屏图标以 4~8ms 的极低延迟畅玩 Mac 本机上的 RPG Maker 游戏。

然而，在当前的运行模式下，游戏是作为**前台独立桌面窗口**运行的，存在以下核心痛点：

### 痛点 1：Mac 物理扬声器声音外放打扰
- 启动串流后，游戏音频同时输出至 Mac 电脑的系统默认扬声器；
- 宿主机用户在日常使用电脑时（如工作、会议、看视频、听歌），会被游戏的背景音乐（BGM）和战斗音效严重打扰，同居室内也无法做到静音游玩。

### 痛点 2：前台窗口霸占屏幕与焦点
- 游戏每次启动都会在 macOS 桌面弹出一个独立的 NW.js 窗口；
- 不仅遮挡主机的正常工作界面，窗口还会抢夺键盘与鼠标输入焦点；若将窗口最小化，容易误触或被系统节电机制处理。

### 痛点 3：单游戏独占排他性，无法多端并发游玩
- 当前的进程管理（`launch` 与 `game-process`）采用单例模式设计：当拉起新游戏或切换游戏时，系统会自动强杀当前运行的所有游戏进程；
- 一台配置充裕的 Mac（如 16GB / 24GB / 32GB 统一内存的 Apple Silicon 机型）完全有能力承载 3~6 个不同轻量级 RPG Maker 游戏的并发运行；但受限于当前的架构，无法满足家庭或多设备用户“一人一部手机、各自连入玩不同游戏”的场景。

### 痛点 4：窗口隐藏带来的 Canvas 降频停摆风险
- Chromium / NW.js 在窗口处于隐藏、最小化或宿主屏幕锁屏状态下，会自动启用严格的节电机制（Throttling），将 `requestAnimationFrame` 暂停或降频至 1 FPS；
- 若缺乏针对性的渲染心跳保活与启动参数配置，简单的“隐藏窗口”会导致 WebRTC 视频帧冻结、推流黑屏。

---

## 2. 核心目标与衡量指标

| 编号 | 目标项 | 详细定义与衡量标准 |
| :--- | :--- | :--- |
| **G1** | **Mac 宿主机 100% 物理静默** | 宿主机物理扬声器/耳机 0 分贝发声；手机移动端 100% 接收全音质双声道游戏 BGM、UI 音效与技能配音。 |
| **G2** | **桌面 0 弹窗（完全无感后台化）** | 启动游戏后，macOS 桌面、Dock 栏不产生任何前台弹窗，不抢夺键盘鼠标输入焦点，宿主机正常使用不受任何视觉干扰。 |
| **G3** | **无头状态稳定 60 FPS 推流** | 无论宿主机桌面如何切换应用、窗口是否最小化、甚至是 Mac 锁屏，底层 Canvas 渲染与 WebRTC 视频流采集维持稳定 60 FPS，延迟 ≤ 10ms。 |
| **G4** | **多游戏并发独立运行（多房间隔离）** | 支持单台 Mac 同时静默托管多个不同的 RPG Maker 游戏；设备 A 玩游戏 1、设备 B 玩游戏 2，信令通道、音视频画面、触摸与虚拟按键输入完全隔离，互不串流、互不干扰。 |
| **G5** | **单游戏独占防顶替保护** | 同一款游戏遵循“一游一端”原则；若某款游戏正在被玩家游玩，其他设备尝试访问时给出友好的正在游玩提示，防止游戏存档被意外覆写或按键相互干扰。 |
| **G6** | **空闲实例自动回收（GC）** | 当某款游戏的 WebRTC 客户端全部断开且持续超过设定阈值（如 15 分钟），后台自动执行安全保存并退出该游戏无头进程，释放系统内存与 CPU。 |
| **G7** | **客户端主动退出与平滑返回** | 移动端浮动操作坞提供【退出游戏】动作，确认后优雅终止对应后台进程并即刻释放内存，页面平滑返回游戏大厅。 |

---

## 3. 用户场景与角色旅程

### 场景 1：宿主机无感静默游玩
1. 用户在 Mac 上正常办公、编程或观看视频，无需开启任何游戏窗口；
2. 用户在床上拿起 iPhone，打开桌面图标「Chaya 串流」；
3. 画面瞬间进入游戏（如 60 FPS、4ms 延迟），手机端扬声器/耳机传出清晰立体的游戏音乐；
4. Mac 电脑全程保持完全静音，桌面上没有任何游戏窗口跳出，互不打扰。

### 场景 2：局域网多设备并发游玩不同游戏
1. 宿主机运行 Chaya 服务端，本地游戏库配置了《RPG 游戏 A》与《RPG 游戏 B》；
2. 玩家 1 在客厅使用 iPad 访问 `http://192.168.31.89:3000/play?game=gameA`，系统拉起游戏 A 静默进程并秒连推流；
3. 玩家 2 在卧室使用 Android 手机访问 `http://192.168.31.89:3000/play?game=gameB`，系统拉起游戏 B 静默进程并秒连推流；
4. 两位玩家各自操作自己的游戏，两套 WebRTC 信令、音视频流、摇杆输入完全独立，运行流畅。

### 场景 3：同款游戏独占提示
1. 玩家 1 正在手机端游玩《游戏 A》；
2. 玩家 2 打开网页尝试选择《游戏 A》；
3. 页面弹出友好提示：“《游戏 A》当前正由其他设备游玩中，请稍后再试或选择其他游戏”，并引导进入游戏列表选择《游戏 B》。

### 场景 4：设备离线与资源自动释放
1. 玩家游玩完毕，直接滑动关闭手机 Safari 或关闭屏幕；
2. Chaya 服务端检测到《游戏 A》的 WebRTC DataChannel 与视频连接断开；
3. 启动 15 分钟空闲保护计时器；
4. 若 15 分钟内玩家重新点亮屏幕进入，瞬间恢复连接继续游玩；
5. 若超过 15 分钟无任何连接重入，服务端自动向游戏注入保存指令，随后安全退出该游戏的 NW.js 进程，回收占用的 250MB 内存。

### 场景 5：手机端主动退出游戏
1. 玩家在游戏浮动快捷球或常用菜单中点击【退出游戏】；
2. 弹出二次确认弹框（“退出前请确保游戏已保存，是否确认退出？”）；
3. 玩家确认后，手机端发送退出指令，服务端优雅终止该游戏的无头进程；
4. 手机端平滑返回 `/play` 游戏大厅列表，房间连接释放，内存立即回收。

---

## 4. 系统架构与功能详细规范

### 4.1 整体架构拓扑图

```text
       ┌─────────────────┐             ┌─────────────────┐
       │  移动端 A (iPhone) │             │  移动端 B (iPad)  │
       │   游玩《游戏 A》   │             │   游玩《游戏 B》   │
       └────────┬────────┘             └────────┬────────┘
                │ WebRTC 流 A                   │ WebRTC 流 B
                ▼                               ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                 Chaya 本地服务端 (Mac 主机)                 │
  │                                                             │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │  多房间信令中心 (Signaling Room Hub)                  │  │
  │  │  - Room: game-A (Token A) ◄───► 设备 A               │  │
  │  │  - Room: game-B (Token B) ◄───► 设备 B               │  │
  │  └───────────────────────────────────────────────────────┘  │
  │                                                             │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │  多实例进程管理器 (GameInstanceManager)               │  │
  │  │  - 维护进程池: Record<GameId, InstanceInfo>           │  │
  │  │  - 精准启动 / 状态探活 / 独占检查 / 闲置超时自动 GC    │  │
  │  └──────────────┬─────────────────────────┬──────────────┘  │
  │                 │ 拉起 / 监控              │ 拉起 / 监控    │
  │                 ▼                         ▼                 │
  │     ┌───────────────────────┐ ┌───────────────────────┐     │
  │     │ 游戏 A 后台静默进程    │ │ 游戏 B 后台静默进程    │     │
  │     │ (NW.js / PID 101)     │ │ (NW.js / PID 102)     │     │
  │     │ - 窗口隐藏 (无弹窗)   │ │ - 窗口隐藏 (无弹窗)   │     │
  │     │ - Mac 扬声器物理断开  │ │ - Mac 扬声器物理断开  │     │
  │     │ - WebRTC 独享音频推流 │ │ - WebRTC 独享音频推流 │     │
  │     │ - Canvas 60 FPS 保活  │ │ - Canvas 60 FPS 保活  │     │
  │     └───────────────────────┘ └───────────────────────┘     │
  └─────────────────────────────────────────────────────────────┘
```

---

### 4.2 双模启动机制（Silent vs Windowed）

系统需支持清晰的双模启动分流：
1. **远程串流启动（Silent 无感模式，默认）**：
   - 触发来源：移动端访问 `/play` 或调用 `/api/launch?mode=silent`；
   - 行为：启动 NW.js 时传入隐藏窗口与防节流参数，Mac 本地静音，只推流到 WebRTC。
2. **桌面原生启动（Windowed 窗口模式）**：
   - 触发来源：Mac 本地 Chaya Web 控制台（`/` 或 `/cheat`）点击“运行游戏”；
   - 行为：维持传统的桌面独立窗口弹出与 Mac 物理声卡发声，满足本地调试需求。

---

### 4.3 音频链路物理分流规范（Audio Stream Isolation）

RPG Maker MV / MZ 的音频系统基于 HTML5 `WebAudio API` 实现：
- 原生链条：`WebAudio._masterGainNode` 直接连接至硬件扬声器 `ctx.destination`。
- 改造后链条：
  ```text
  [ 游戏音效/BGM 节点 ] ──► [ _masterGainNode ]
                                  │
                                  ├─(断开物理声卡)─X─► [ ctx.destination (Mac 扬声器) ]
                                  │
                                  └─(单向串流接管)───► [ MediaStreamDestination ] ──► [ WebRTC AudioTrack (手机端) ]
  ```
- **技术规范**：
  1. 插件注入阶段：在 `remote-stream.ts` 中检测到 `AudioContext` 初始化时，主动将 `_masterGainNode` 与 `ctx.destination` 的物理连接解除（`disconnect(ctx.destination)`）或插入 0 增益节点；
  2. 串流连接阶段：`_masterGainNode` 持续连接至 `ctx.createMediaStreamDestination()`，确保 WebRTC 音频轨道数据流 100% 完整；
  3. 可选保留开关：在控制台提供“允许电脑同步发声”调试开关（默认关闭），方便需要时在主机排查音频问题。

---

### 4.4 无头静默生命周期规范（Headless Execution & Keepalive）

- **无头窗口配置**：
  - 启动 NW.js 时传入 `--window-hidden` 命令行标志，或动态在游戏执行目录的 `package.json` 临时配置写入 `"window": { "show": false }`；
  - 宿主机系统完全不分配前台窗口句柄，Dock 栏不激活弹跳动画。
- **底层渲染防休眠与降频策略**：
  - Chromium 启动参数强制关闭休眠策略：
    ```bash
    --disable-background-timer-throttling
    --disable-renderer-backgrounding
    --disable-backgrounding-occluded-windows
    --disable-features=CalculateNativeWinOcclusion
    ```
  - **渲染心跳保活（Keepalive Loop）**：
    - 针对无头环境下 `requestAnimationFrame` 可能被 Chromium 节流的情况，由已落地的 `ensureGameRenderKeepalive()` 保活调度器接管；
    - 若上一帧渲染间隔超过 65ms，主动触发 `SceneManager.renderScene()` 或 `Graphics.render()`，确保每秒产生稳定的 60 帧图像送入 WebRTC 编码管线。

---

### 4.5 多实例进程池与精准管理（Multi-Instance Game Manager）

当前系统采用单一全局变量 `terminateAllRunningGameProcesses()`，切换游戏时会杀死所有 NW.js 进程。多实例模式需升级为精准粒度管理：

1. **实例元数据模型**：
   ```typescript
   export type GameInstance = {
     gameId: string
     contentRoot: string
     pid: number
     roomId: string
     status: "starting" | "running" | "stopping" | "idle"
     createdAt: number
     lastConnectedAt: number
     activeWebRtcClients: number
   }
   ```
2. **实例生命周期操作**：
   - `ensureGameRunning(gameId: string, options?: { mode?: "silent" | "windowed" }): Promise<GameInstance>`：若该游戏已有运行中实例，直接复用返回；若无，启动专属无头进程。
   - `stopGameInstance(gameId: string): Promise<void>`：仅终止指定 `gameId` 的进程，绝不影响其他并发运行的游戏。
   - `findGameInstance(gameId: string): GameInstance | null`：查询特定游戏运行态。
3. **同游戏互斥与独占锁**：
   - 每个 `gameId` 对应一个排他互斥锁；
   - 若 `activeWebRtcClients > 0`，其他客户端尝试连入相同 `gameId` 时返回状态码 `409 GAME_ALREADY_IN_USE`。

---

### 4.6 客户端路由与房间分发

1. **URL 参数路由**：
   - `/play?game=[gameId]`：直接定位指定游戏并连接对应房间；
   - `/play`（无参数）：展示「游戏选择大厅」，列出本地可用游戏及其运行状态（空闲 / 游玩中）。
2. **信令房间自动绑定**：
   - 信令服务（`webrtc-signaling.ts`）已有 `SignalingRoom` 机制；
   - 自动将 `roomId` 设为 `game_${gameId}`，双方在独立房间完成 SDP Offer/Answer 握手与 ICE 穿透，天然实现完全隔离。

---

### 4.7 同款游戏多开演进预留（Same-Game Multi-Instance Architecture Reserve）

- **当前阶段策略**：实行同款游戏独占制（一游一人），若某款游戏正在被设备游玩，其他设备进入时提示占用，保障存档与按键互不干扰。
- **下一阶段预留架构（同款游戏多开）**：
  1. **存档沙箱隔离**：同一款游戏在并发多开时，不能直接共享读写游戏目录下的 `save/` 文件夹或相同的 Chromium `localStorage`；
  2. **轻量工作副本机制**：多开时通过符号链接（Symlink）或独立指定 `--user-data-dir` 将存档与运行时状态隔离至 `Chaya/storage/instances/[gameId]_[instanceId]/`；
  3. 本期设计中，实例管理器的 Key 采用 `instanceId`（默认等于 `gameId`，未来平滑升级为 `${gameId}_${userId}`），底层完全保留同款游戏多开的扩展能力。

---

### 4.8 闲置资源自动回收机制（Idle Garbage Collection）

- **回收触发条件**：
  - 某个游戏实例的 `activeWebRtcClients === 0` 且持续时长超过 `IDLE_TIMEOUT_MS`（默认 15 分钟，可在配置中调整为 5~60 分钟）；
- **平稳回收流程**：
  1. 向该游戏进程发送自动保存指令（若游戏支持自动存档）；
  2. 优雅通知游戏进程退出（`SIGTERM`）；
  3. 若 3 秒内未退出，强制回收（`SIGKILL`）；
  4. 从活跃实例表中注销该实例，释放内存与 CPU。

---

### 4.9 容灾与异常自愈策略

| 异常场景 | 触发机制 | 自动化容灾处理行为 |
| :--- | :--- | :--- |
| **后台进程意外崩溃** | NW.js 进程抛出未捕获致命错误退出 | 进程管理器监听 `process.on("exit")`，立即清理实例映射，通知前端“游戏意外中断”，允许一键重新启动 |
| **网络短时丢包或抖动** | 局域网 WiFi 切换或暂时弱网 | WebRTC 自带 ICE 自动重连机制，前端连接中展示优雅呼吸动效，10 秒内恢复不杀后台进程 |
| **多设备争抢同款游戏** | 设备 B 在设备 A 游玩时尝试强连 | 接口校验 `activeWebRtcClients > 0`，返回 `409` 错误码及正在游玩提示，拒绝第二设备写入信令 |
| **僵死孤儿进程** | 宿主机异常重启或断电恢复 | Chaya 服务端启动时，扫描系统中残留的无头 NW.js 进程并执行一次性安全清扫，防止幽灵进程占用端口和内存 |

---

## 5. 性能、功耗与资源预算

以 Apple Silicon（如 M1 / M2 / M3 / M4 系列芯片，16GB 内存）环境为基准：

| 评估指标 | 单游戏实例消耗 | 4 实例并发估算 | 6 实例并发估算 | 结论与保障 |
| :--- | :--- | :--- | :--- | :--- |
| **内存占用 (RAM)** | 180MB ~ 280MB | ~1.0 GB | ~1.6 GB | 16G 机器仅占总内存 ~10%，完全不影响日常工作 |
| **CPU 占用** | 3% ~ 6% (单核) | 12% ~ 24% (单核) | 18% ~ 36% (单核) | 多核心负载极轻，风扇几乎不转 |
| **GPU / 编码负载** | Apple 硬件 VideoToolbox H.264 编码，占用 < 5% | ~15% | ~22% | 硬件编解码器专核专用，无卡顿 |
| **端到端局域网延迟** | 4ms ~ 8ms | 4ms ~ 8ms | 5ms ~ 10ms | 房间彼此独立，网络传输互不竞争通道 |

---

## 6. 实施路线图与验收检查清单（Roadmap & Verification Checklist）

### Milestone 1：单游戏无感静默运行（P0）
- [ ] 改造 `remote-stream.ts`：断开 `_masterGainNode` 与 `ctx.destination` 的物理连接，实现 Mac 本地 0 声音 + 手机端满音质；
- [ ] 改造 `services/platform/host/osx.ts`：启动 NW.js 时支持隐藏前台窗口及注入 Chromium 防降频参数；
- [ ] **验收项**：启动游戏后 Mac 桌面 0 弹窗、物理声卡 0 分贝发声；手机端 Safari 连入后稳定 60 FPS、音频清晰可闻；Mac 锁屏后手机端仍稳定流畅。

### Milestone 2：多实例进程池与精准管理（P1）
- [ ] 改造 `services/game/game-process.ts` 与 `app/api/launch`：
  - 建立 `GameInstanceManager` 实例映射池；
  - 支持按 `gameId` / `contentRoot` 独立启动与停止，取消“启动新游戏前杀掉全部游戏”的限制；
- [ ] 建立同游戏互斥锁机制（防止同一款游戏被多人同时顶替）；
- [ ] **验收项**：手机 A 打开《游戏 1》、手机 B 打开《游戏 2》，两边同时在线，音画和摇杆互不串台、互不卡顿；手机 C 尝试连《游戏 1》时正确收到“占用中”拒绝提示。

### Milestone 3：移动端游戏选择大厅与空闲自动回收（P2）
- [ ] `/play` 增加直观的游戏列表选择抽屉/卡片页，展示各游戏在线状态与封面图；
- [ ] 实现空闲 15 分钟无人连接自动保存并退出进程的垃圾回收机制；
- [ ] 浮动操作坞增加【退出游戏】功能，二次确认后立即终止后台游戏进程并返回大厅；
- [ ] **验收项**：手机端主动退出或关闭网页 15 分钟后，后台对应游戏进程完全退出，内存完全回收。
