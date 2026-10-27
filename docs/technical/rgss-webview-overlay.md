# RGSS 内嵌 WebView 插件与双向通信架构技术设计

> **状态**：实施中：macOS 宿主可编译，窗口行为待真机验收；Windows 宿主待实现  
> **适用范围**：RPG Maker VX Ace / VX / XP (RGSS1 / RGSS2 / RGSS3 引擎)  
> **关联设计**：
>
> - [docs/run-modes.md](../run-modes.md)（local / edge / plugin 模式定义）
> - [docs/rgss-webview-overlay.md](../rgss-webview-overlay.md)（需求与产品定位规范）
> - [docs/technical/mini-panels.md](./mini-panels.md)（浮动面板与迷你屏交互标准）
> - [docs/technical/chaya-ui-style-guide.md](./chaya-ui-style-guide.md)（Chaya 统一视觉规范）
> - [docs/technical/webmcp.md](./webmcp.md)（WebMCP / DataChannel 通信协议）

---

## 1. 架构总览

针对 RGSS（基于 mkxp-z / SDL2 原生 C 宿主运行环境），放弃独立编译外部网络转发服务的路线，直接利用操作系统原生轻量浏览器组件（macOS `WKWebView` / Windows `WebView2`）以子视图形态附着于 SDL2 游戏窗口之上，实现局内 UI 呈现与全端通信一体化。

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 外部控制端                                                              │
│  - Local 控制台 (http://127.0.0.1:3000)                                │
│  - Cloud 远程控制台 (https://chaya.app，零中继流量)                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    │  WebRTC DataChannel 纯 P2P 直连
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 游戏进程窗口 (mkxp-z / SDL2 Window)                                     │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 操作系统原生内嵌 WebView 浮层 (WKWebView / WebView2)              │  │
│  │                                                                  │  │
│  │  1. 局内 GameEdit 浮层 (React / 悬浮球 / 侧栏抽屉)               │  │
│  │  2. 多迷你屏集群 (MiniPanelDock: 快速存档 / 地图雷达 / 状态微件) │  │
│  │  3. 原生 WebRTC Client (window.RTCPeerConnection)                │  │
│  │     - 监听专属房间，与外部 Local / Edge 控制台直接握手建连       │  │
│  │     - 充当全端通信网关，双向透明转发                             │  │
│  └───────────────────────────────┬──────────────────────────────────┘  │
│                                  │                                     │
│                                  │ 双向原生 JS 桥 (postMessage)        │
│                                  ▼                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ RGSS Ruby 运行时环境 (plugins/rgss/)                              │  │
│  │                                                                  │  │
│  │  - preload.rb / bridge.rb: 挂载 SDL Window，注入 WebView 宿主    │  │
│  │  - Game Hooks: 截获变量/开关/金币/物品，执行实时读写             │  │
│  │  - 寻路与移动: $game_player.find_path / 鼠标点击移动交互         │  │
│  │  - 热键管理: 响应 F12、右键或控制台唤出信号                      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心架构优势与设计原则

1. **零第三方网络服务编译**：
   不引入 Go、Rust 或 Node 外部伴生子进程。WebRTC 标准协议栈直接跑在系统原生 WebView 内部，不额外编译 WebRTC 协议栈；仍需编译平台 WebView 宿主适配动态库，并在实际系统版本验证 DataChannel 可用性。
2. **零服务器中继流量（Edge 友好）**：
   外部 Cloud 网页与游戏内 WebView 通过信令服务交换 SDP 并周期轮询房间状态；游戏业务数据走 DataChannel，不走业务服务器中继。信令仍有请求和带宽成本。不配置 TURN 时，受限 NAT / 防火墙可能无法建连，不能保证所有网络可达。
3. **零端口监听、零防火墙拦截**：
   游戏与内嵌 WebView 之间完全依赖 OS 内存级调用（`evaluateJavaScript` / `WKScriptMessageHandler` / `WebMessageReceived`），本地不监听任何 TCP 端口（彻底废弃 `ws://127.0.0.1:3928`），免去防火墙拦截弹窗与端口冲突隐患。
4. **多迷你屏统一图层调度**：
   采用单全屏透明 WebView 承载整个浮层系统，未唤起交互时启用点击穿透（Click-Through），在同一 WebView 上下文中灵活展示 GameEdit 主面板与多个迷你屏（MiniPanels）。

---

## 3. 宿主集成与窗口生命周期细节（CR 重点强化）

### 3.1 跨平台宿主视口挂载

mkxp-z 底层创建的标准窗口类型为 `SDL_Window`，通过 FFI / 动态库获得原生视口句柄：

| 平台        | 取得句柄方式                                     | 原生 WebView 类型          | 挂载父级容器                                |
| :---------- | :----------------------------------------------- | :------------------------- | :------------------------------------------ |
| **macOS**   | `SDL_GetWindowWMInfo` → `info.info.cocoa.window` | `WKWebView`                | `[nswindow.contentView addSubview:webView]` |
| **Windows** | `SDL_GetWindowWMInfo` → `info.info.win.window`   | `WebView2` (Chromium Edge) | `CreateCoreWebView2Controller(hwnd, ...)`   |

### 3.2 原生点击穿透与输入

macOS 宿主的 `ChayaWebView.hitTest:` 根据前端预先发布的交互区域返回 WebView 或 `nil`。
前端遍历包括 Shadow DOM 在内的实际面板几何位置，每 50ms 仅在区域变化时发布 `host.regions`，不依赖已经被穿透窗口收不到的 mouseover。
原生桥独立处理这些宿主消息，不把它们当游戏修改命令。F10 由原生窗口键盘监视器唤起共享 GameEdit 工作台。

Windows 的 WebView2 窗口挂载与穿透仍待实现，不能用 CSS `pointer-events` 代替原生窗口 hit-test。
拖拽、缩放、全屏、焦点恢复、Esc 和多迷你屏叠放均需真机验收。

### 3.3 本地页面与权限

当前 macOS 宿主使用 `loadFileURL` 加载打包目录中的 HTML，只授权该目录的资源读取，并阻止跳转到其他文档。
凭据通过 document-start 原生脚本注入 `window.__CHAYA_RGSS_CONFIG__`，不写入 HTML，也不拼入 URL。
不能假定自定义协议天然属于安全上下文；不得使用 `--disable-web-security` 等全局放宽安全的参数。
信令请求沿用已有 CORS 与令牌契约。WebRTC、本地存储与系统版本兼容性需在实际 WKWebView 上验证。

### 3.4 画面拉伸与黑边（Letterbox/Pillarbox）视口对齐

针对 RGSS 游戏常见的 4:3 固定纵横比拉伸或 `Alt+Enter` 全屏模式：

- 宿主从 SDL 渲染器（`SDL_GetRendererOutputSize` 或 mkxp-z 视口矩形）读取实际游戏游戏画面的渲染有效矩形（Game Viewport Rect）；
- 将该 Rect 通过参数注入内嵌 WebView，前端根容器自动应用绝对定位居中与安全边距（Safe Margins），确保小地图与快捷存档迷你屏停靠在**游戏实际画面的边缘**，而非显示器黑边区域。

---

## 4. 双向通信协议设计（Ruby ↔ WebView ↔ 外部控制台）

通信协议完全复用项目现有的 `GameLinkProtocol` 标准 JSON 格式（定义于 [`lib/runtime/game-link-protocol.ts`](../../lib/runtime/game-link-protocol.ts)）。

### 4.1 数据通道路由与分发时序

```text
[外部 Edge 控制台]               [游戏内 WebView]                [RGSS Ruby 核心]
        │                               │                              │
        │── 1. edit.run (WebRTC) ──────>│                              │
        │                               │── 2. window.dispatch ───────>│
        │                               │   (native postMessage)       │
        │                               │                              │── 3. 改变 $game_party.gold
        │                               │<── 4. edit.ack (JS 调用) ────│
        │<── 5. edit.ack (WebRTC) ──────│                              │
```

### 4.2 具体通信接口实现

#### 1. WebView → Ruby（控制指令下发）

```typescript
// 统一通信垫片，自动兼容系统宿主
export function postToGame(message: unknown): void {
  const json = JSON.stringify(message)
  const g = window as any
  if (g.webkit?.messageHandlers?.chaya) {
    g.webkit.messageHandlers.chaya.postMessage(json)
  } else if (g.chrome?.webview) {
    g.chrome.webview.postMessage(json)
  }
}
```

#### 2. Ruby → WebView（状态回执与主动推送）

```ruby
def post_to_webview(message)
  json_str = message.to_json
  # 调用底层封装的执行 JS 方法
  NativeWebview.eval_js("window.__chaya_on_game_message(#{json_str.dump})")
end
```

WebView 端全局接收后：

1. 本地 React 状态机即时响应（如迷你屏金币数字跳动、小地图位置移动）；
2. 若当前与外部 Local/Edge 控制台保持着 WebRTC DataChannel，则通过通道将消息直接回传给远端。

---

## 5. 前端插件架构与工程隔离

RGSS 前端插件严格与 MV/MZ 隔离，保持项目结构清晰，互不产生运行时冲突。

### 5.1 两个独立子模块

```text
plugins/
├── build.mjs                 # 只调度两个子模块
├── mv/
│   ├── src/                  # MV/MZ 既有插件入口与引擎适配
│   ├── typings/
│   ├── build.mjs
│   ├── vite.config.mjs
│   ├── tsconfig.json
│   ├── manifest.json
│   └── dist/
├── rgss/
│   ├── src/entry.tsx          # RGSS 专用前端入口
│   ├── native/host.mm         # macOS WKWebView C ABI 宿主
│   ├── native_webview.rb      # Fiddle 适配、主线程队列、启动配置
│   ├── bridge.rb              # 游戏线程消息泵
│   ├── saves.rb
│   ├── map.rb
│   ├── preload.rb
│   ├── build.mjs
│   ├── vite.config.mjs
│   ├── tsconfig.json
│   ├── manifest.json
│   └── dist/
└── shared/                   # 无引擎状态的存档 UI、样式和类型声明
```

### 5.2 构建与产物隔离

- `pnpm build:plugins:mv` 输出 `plugins/mv/dist/Chaya*.js`，MV manifest、安装器、摘要和热更新读取此目录。
- `pnpm build:plugins:rgss` 输出 `plugins/rgss/dist/ChayaRGSSOverlay.js` 与 `rgss-overlay.html`；macOS 还编译 `libchaya-overlay.dylib`。
- 根 `pnpm build:plugins` 只调度两个子模块，每边只清理自己的 dist。
- 两个子模块分别使用自己的 Vite 与 TypeScript 配置。RGSS 不得导入 MV 的源码或游戏全局对象；可复用组件放 shared 或现有 components/lib。
- Ruby 接收 WebView 消息使用有界队列，在 `Graphics.update` 消费；WebKit 的创建、执行脚本与销毁均派发到 AppKit 主线程，原生回调不直接执行 Ruby。
- `pnpm dev` 额外启动 `rgss-sync`，通过 SSE 长连接监听 `/api/dev/rgss-sync`。运行态必须由 Next 服务进程判定，由服务端监听源码目录变动及进程启停推送同步事件，避免盲目轮询刷屏；游戏未运行时完整安装，运行且 bridge 已连接时只同步 `bridge.rb` 会重新 `load` 的 Ruby。`Scripts.rvdata2`、overlay/native 资源和非热重载 Ruby 在运行期间保持不动，退出后触发完整安装。

---

## 6. 废弃清理清单

方案落地后，原先为 RGSS 临时引入的过渡网络实现彻底移除：

| 待移除文件 / 模块                         | 移除原因                                   | 替代方案                                                     |
| :---------------------------------------- | :----------------------------------------- | :----------------------------------------------------------- |
| `services/runtime/bridge-ws-server.ts`    | 本地 Node 端开设的 3928 WS 转发服务器      | 由 WebView 内置 WebRTC 直接与远端 P2P 握手，不再占用本地端口 |
| `plugins/rgss/ws_client.rb`               | 纯 Ruby 编写的 RFC 6455 简易客户端         | 游戏与 WebView 改用系统原生双向 JS 桥（`postMessage`）       |
| `app/api/status/route.ts` 中的 WS 探活    | 用于探测本地是否有 RGSS 游戏连接的临时逻辑 | 统一收敛至标准 WebRTC 信令与客户端在线态探测                 |
| `lib/runtime/web-game-link.ts` 的双规并发 | 前端同时尝试连接 WS 与 WebRTC 的分支代码   | 统一全线收敛为单一的 WebRTC 通道                             |

## 7. 当前验证范围与待办

已增加 Edge 令牌、answer 发布失败重试、旧异步结果作废、DataChannel 重连、原生桥编码、区域发布、存档面板 transport，以及真实 Ruby 变量/金币/快捷存档往返测试。
macOS 原生动态库编译通过不等于窗口集成验收通过；游戏已卸载，窗口挂载、渲染和输入未实测。
Windows 原生宿主与实时桥、自动存档计时、app 存储后端和小地图传送仍待实现。当前小地图仅浏览，工作台未适配的命令返回失败，不能伪装成功。

macOS 原生冒烟测试 `pnpm test:rgss:native` 已用临时窗口验证 WKWebView 挂载、配置注入、原生桥、实际 DataChannel 传输和局部点击穿透。这不替代 SDL/mkxp-z 游戏窗口的集成验收。

## 8. RGSS 预译文显示

`preload.rb` 加载独立的 `translation.rb` / `translation_store.rb`。启动器通过 `CHAYA_RGSS_CONTENT_ROOT` 指定游戏目录，读取 `chaya/translate/seed.json` 与 `cache.ndjson`，兼容旧文件名及数组缓存行。此路径只消费已保存译文，不依赖翻译引擎开关，也不改写游戏数据库或存档。

- 游戏脚本加载完成、进入 `SceneManager.run` / `Scene_*.main` 时才安装显示钩子；`Graphics.update` 作为兼容回退。避免 preload 阶段 prepend 与游戏后续 alias 包装产生递归。
- `Bitmap.draw_text` 与 `text_size` 使用同一译文；`Window_Base.convert_escape_characters` 在逐字绘制与变量、角色名控制符展开前翻译对白和选项。单字绘制只处理字体，不逐字翻译。
- 查找使用内存哈希中的原文、规范化文本、数字控制符模板和控制符分段；另按当前游戏状态生成 `\N` / `\P` / `\V` / `\G` 展开后的整句别名，供渲染器已展开控制符的文本反查。别名只在缓存或引用值变化时重建，绘制路径仍是哈希查找；不做模糊查询或任意子串替换。译文中的同一控制符展开时优先使用该角色名、变量值或货币单位自身的缓存译文，例如 `\N[8]` → `Monquis` → `蒙基斯`，缺失才回退运行时原文。
- 同一展开文本对应不同译文时不猜测，跳过该别名；角色改名、队伍变化、变量变化或缓存替换后旧别名失效。已绘制窗口仍不强制刷新，下一次绘制使用新索引。
- 首次同步加载，之后每秒在后台检查变更；追加行增量读取，半行等待补齐，截断、替换或 seed 更新触发重建。按缓存 origin 处理删除事件，保护本地手工译文。新快照替换查找索引并使结果记忆失效，新绘制文字使用新缓存；已绘制窗口不强制刷新。
- macOS 把系统 `STHeiti Light.ttc` 以 `.ttf` 扩展名链接到会话专属 RTP 的 `Fonts` 目录（mkxp-z 的发现规则要求此扩展名）。中文绘制和测量临时选用支持中文的字体，随后恢复游戏字体；不修改游戏的 Fonts 目录。
- 已运行旧插件的游戏需要保存、退出后从 Chaya 重新启动一次，以加载显示模块和字体资源。之后缓存更新不需重启。

验证包括 Ruby 生产模块的菜单、对白、选项、控制符、缓存追加/删除/截断、手工译文保护、字体恢复和重复加载测试；另用独立 mkxp-z 3.1.3 Ruby 实例读取实际游戏缓存，调用游戏原有的 `Game_Message` / `Window_Base` 方法，验证中文输出并检查原生位图。该验证不等同于完整游戏全场景验收；实时翻译与字幕模式不由此缓存适配器实现。

## 9. 壳与插件独立安装

RGSS 运行时壳与游戏插件各自管理：macOS 的壳是共享 mkxp-z；Windows 使用作品自带 Game.exe。插件安装到每个游戏的 `chaya/plugins/rgss/`，包含独立 Ruby 入口、缓存显示模块及可用的原生浮层产物。状态接口报告 `ChayaRGSS` 的安装和版本状态，复用控制台现有安装、更新、清除按钮。游戏运行期间禁止安装与清除；macOS 启动器只加载该游戏已安装的 preload，不再隐式加载仓库源码。

安装器读取原脚本集合（支持 VX Ace 加密包），生成包含 ChayaRGSS 入口的独立 `Scripts.rvdata2` 副本，将入口放在 Main 之前，并将 Game.ini 的 Scripts 指向这个副本。原 Data/Scripts 与加密包不改写；Game.ini 按原始字节保留标题编码并备份。清除时只还原仍指向插件副本的 Scripts 行，不覆盖用户其它 INI 修改，不清除翻译缓存。VX 加密脚本需先解包到 Data；无法识别 Main 或解析脚本时安装失败，不修改配置。

Windows 原版 Ruby 通过 `native.rb` 加载缓存翻译，使用无外部 JSON 依赖的解析器和旧 Ruby 的 alias 钩子，不加载 mkxp-z 的 Windows API 兼容层或 macOS WebView。VX Ace 在文字控制符展开前替换显示文本；VX 在 Window_Message.start_message 内使用临时显示副本并恢复原数组，保持解释器通过 texts/choices 添加内容的行为。

Windows 的缓存翻译入口已完成契约测试；Windows 原生 WebView / WebRTC 桥仍未实现。验证环境为 macOS：覆盖安装、版本变化、重复更新、卸载恢复、旧 Ruby API 降级及缺失 JSON 的流程，并用安装到隔离目录的实际游戏脚本副本和缓存运行 mkxp-z、验证中文位图。没有 Windows 真机验收，不能据此宣称 Windows 全功能与 MV 对等。
