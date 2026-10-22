# RGSS 内嵌 WebView 插件体系与 WebRTC 通信重构需求

- **日期**：2026-10-22
- **状态**：实施中 / macOS 原生宿主可构建，窗口验收与 Windows 待完成
- **适用范围**：RPG Maker VX Ace / VX / XP (RGSS 系列)
- **技术设计**：[RGSS 内嵌 WebView 插件与双向通信架构技术设计](technical/rgss-webview-overlay.md)

---

## 1. 背景与核心诉求

### 1.1 现状与痛点

在现有架构中，MV/MZ 系列游戏依托 Chromium / NW.js 的完整 Web 能力，通过原生 DOM 挂载局内插件 UI（GameEdit 面板与 MiniPanels），并借助浏览器自带的 WebRTC DataChannel 与外部控制台（Local 本地服务或 Cloud Edge 线上网页）建立零服务器流量的 P2P 直连。

然而，对于 RGSS（VX/VX Ace/XP）游戏，原先临时搭建了本地 Node WebSocket 桥接方案（`ws://127.0.0.1:3928` + Ruby `ws_client.rb`）。该方案暴露出以下关键限制：

1. **Edge 模式（线上网页 / 边缘无盘部署）无法连接**：远程 HTTPS 页面受限于浏览器的安全沙箱机制（Mixed Content 与 Private Network Access），默认阻止连接本地未加密的 `ws://127.0.0.1`。
2. **拒绝边缘服务器流量中继**：在 Edge 模式下若由云端 Serverless 节点中继高频实时游戏数据，将持续耗费网络带宽与连接计费，违背 Edge 零开销轻量原则。
3. **缺少局内原生 UI 呈现能力**：RGSS 缺乏类似 MV/MZ 的现代 HTML5 悬浮卡片、局内 GameEdit 抽屉面板与多个可拖拽迷你屏（MiniPanels）。

### 1.2 破局关键：系统原生 WebView 赋能

我们不再走“独立编译外部 Go/Rust 网络中继进程”的繁琐路径，而是直接利用操作系统自带的原生轻量 WebView（macOS `WKWebView` / Windows `WebView2`），将其作为子视口附着在 RGSS 宿主窗口上方。
由于现代原生 WebView 内置标准的现代浏览器内核与 `RTCPeerConnection`，**内嵌 WebView 本身就能充当游戏对外的 WebRTC P2P 通信网关，同时兼任游戏内的 UI 宿主**。

---

## 2. 核心架构与业务定位

```text
[ 外部控制端: Local 网页 或 Cloud Edge 网页 ]
                      │
                      │  WebRTC DataChannel 纯 P2P 直连 (零云端服务器流量)
                      ▼
┌────────────────────────────────────────────────────────┐
│ RGSS 游戏窗口 (SDL2 宿主)                               │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 操作系统原生内嵌 WebView 浮层 (WKWebView / WebView2) │  │
│  │                                                  │  │
│  │  1. 局内 GameEdit 浮层 (修改金币/物品/变量)       │  │
│  │  2. 多迷你屏集群 (MiniPanels: 存档/地图/状态)    │  │
│  │  3. 原生 WebRTC Client (与外部网页 P2P 直连)     │  │
│  └──────────────────┬───────────────────────────────┘  │
│                     │                                  │
│                     │ postMessage / 原生双向 JS 桥     │
│                     ▼                                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │ RGSS 核心 (Ruby / mkxp-z)                        │  │
│  │                                                  │  │
│  │  - 响应变量/开关修改、金币变动、鼠标寻路移动      │  │
│  │  - 状态数据采集与回传                            │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

1. **零外部网络服务**：无需编译、下发额外的外部伴生网络服务进程，仍需分发平台 WebView 宿主适配动态库。
2. **零服务器中继流量**：外部 Cloud Edge 网页与内嵌 WebView 建立纯点对点（P2P）WebRTC 通信，业务数据不经服务器中继；信令交换和周期轮询仍有少量请求成本。未配置 TURN 时不能保证受限网络下建连。
3. **不新增本地监听端口**：游戏与内嵌 WebView 走操作系统内存级原生桥（`postMessage`），本地彻底不监听任何 TCP 端口，不承诺绕过操作系统或网络策略。
4. **多端状态实时对称**：游戏内内嵌浮层（GameEdit / 迷你屏）与外部控制台对等双控，任何一端修改，另一端实时呈现。

---

## 3. 功能需求范围

### 3.1 局内内嵌浮层与多迷你屏支持

- **全屏透明视口**：内嵌 WebView 采用全屏透明层覆盖在游戏画面上方，默认状态下开启鼠标事件穿透（Click-Through），完全不影响游戏本体的原生点击、移动与按键。
- **多迷你屏（MiniPanels）**：支持快捷存档、小地图雷达等多个悬浮面板在游戏画面内同时漂浮停靠；鼠标悬停或拖拽迷你屏时局部拦截指针事件。
- **GameEdit 展开态抽屉**：按快捷键（如 F12）或外部控制台触发时，游戏右侧平滑滑出 GameEdit 完整修改面板。

### 3.2 外部控制台直连通信（Local & Edge 双通）

- 内嵌 WebView 初始化时自动根据 `roomId` 向信令服务登记，等待外部连接。
- 外部浏览器打开控制台后，秒级接入 WebRTC DataChannel，下发的修改指令经 WebView 转发至底层 Ruby 执行，回执原路返回。

### 3.3 插件体系解耦与代码复用

- **工程解耦**：MV/MZ 与 RGSS 分别放在 `plugins/mv/` 和 `plugins/rgss/`，独立源码目录、构建脚本、Vite/TypeScript 配置、manifest 与 dist；根脚本仅负责调度，共用 UI 与协议抽至现有 components/lib 或 plugins/shared。
- **UI 与协议复用**：100% 复用现有的 GameEdit 表单组件、MiniPanels 浮动视口与 `GameLinkProtocol` 数据交互协议。

---

## 4. 实施阶段与验收指标

1. **阶段一：废弃过渡代码**
   - 彻底移除临时本地 WebSocket 服务（`bridge-ws-server.ts`）及 Ruby 端 `ws_client.rb`。
2. **阶段二：原生 WebView 宿主绑定与 JS 桥**
   - 完成 macOS / Windows 原生视口挂载与 Ruby ↔ WebView 双向 `postMessage` 通信。
3. **阶段三：点亮内置 WebRTC 与全功能验证**
   - 验证外部 Edge 远程网页通过 WebRTC 操控局内内嵌浮层及底层游戏数据。

## 5. 实施记录

详见技术文档第 5–7 节。当前两套插件已拆分独立子模块；macOS 原生宿主动态库、原生 JSON 桥、WebRTC 令牌和重连、共享工作台/存档面板与只读小地图已进入代码验证。
Windows 宿主与实时桥、自动存档计时、app 存储和小地图传送未完成。游戏暂不可用，窗口与输入行为不计为已验收。

macOS 原生冒烟测试 `pnpm test:rgss:native` 已用临时窗口验证 WKWebView 挂载、配置注入、原生桥、实际 DataChannel 传输和局部点击穿透。这不替代 SDL/mkxp-z 游戏窗口的集成验收。

RGSS 游戏现在单独安装 ChayaRGSS 插件，和壳分别展示就绪状态，复用 MV 的安装／更新／清除操作。macOS 壳加载游戏目录中的插件；Windows 原版 Game.exe 通过独立脚本副本加载缓存翻译。安装保留原脚本及加密包，清除恢复配置并保留译文。Windows 实时桥与浮层仍待实现，缓存翻译尚需 Windows 真机验收。详情见技术文档第 9 节。
