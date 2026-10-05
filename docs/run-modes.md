# 运行模式：local / edge / plugin（项目术语）

- **日期**：2026-10-05
- **状态**：已定稿；本文是项目专有名词的唯一定义，讨论需求、写文档、写代码时 **local / edge / plugin** 都按本文理解
- **关联**：[capabilities.md](./capabilities.md)（各模式能力）、[technical/deployment-platforms.md](./technical/deployment-platforms.md)（部署与判定细节）、[mcp-local.md](./mcp-local.md)、[mcp-edge.md](./mcp-edge.md)、[mcp-plugin.md](./mcp-plugin.md)

---

## 1. 一句话定义

| 模式       | 是什么                                                               | 谁读写游戏文件                               |
| ---------- | -------------------------------------------------------------------- | -------------------------------------------- |
| **local**  | 跑在用户电脑上的 Node 环境：本地开发服务、本地 server 服务、App 服务 | 服务进程直接读写本机磁盘                     |
| **edge**   | 部署到线上，用户通过网页使用                                         | 用户浏览器在授权后读写（File System Access） |
| **plugin** | 把插件装进游戏，打开游戏就自动带上插件                               | 游戏进程（NW.js，有 Node 能力）自己读写      |

local 和 edge 是**控制台（网页界面）的两种跑法**，二选一；plugin 是**游戏内的一层**，local 和 edge 都依赖它，也可以单独工作。

## 2. local

用户电脑上的 Node 进程提供控制台和 API。**可能同时存在多个**（比如开着 `pnpm dev`，又开了 App），它们都是 node 环境，能力相同。

| 形式             | 启动方式                       | 默认端口 |
| ---------------- | ------------------------------ | -------- |
| 本地开发服务     | `pnpm dev`                     | 3000     |
| 本地 server 服务 | `pnpm build` + `pnpm start`    | 3927     |
| App 服务         | Electron App（内置同一套服务） | 3927     |

- 能做：直接读写游戏目录、管理游戏库、装壳 / 卸壳、装插件、启动 / 退出游戏、翻译缓存落盘，提供服务端 MCP（`/api/mcp`）。
- 与游戏通信：游戏里的 ChayaAgent 插件长轮询本机服务。
- 代码里的对应：构建目标 `server`（dev 阶段为 `dev`）；服务形态 `local` / `app`（`CHAYA_SERVICE`）；`canUseDisk = true`；界面上叫「服务端模式」；dev 右上角切换器选 **Local**（接口值仍为 `server`）。

## 3. edge

服务部署在线上（Vercel，或自托管 Node 跑 edge 构建），用户打开网页使用。服务器碰不到用户的电脑。

- 能做：用户在 Chrome / Edge 里授权游戏目录后，由浏览器读写普通文件（装插件、改配置、Windows 装壳等）。
- 做不到（浏览器硬限制）：启动本机进程、`chmod`、签名、创建符号链接，所以 macOS 装壳交给终端脚本。卸载壳由浏览器直接删，不弹框；不授权或浏览器拒绝（如 macOS 壳的符号链接）时只报错。
- 与游戏通信：游戏打开后，经 WebRTC 数据通道由游戏替页面干活；游戏没打开时只能靠浏览器读写文件。
- 没有服务端 MCP，只有页面上的 WebMCP。
- 代码里的对应：构建目标 `edge`（`VERCEL=1` 或 `CHAYA_TARGET=edge`，构建时决定）；服务形态 `vercel`；`canUseDisk = false`；界面分支 `browserMode`，文档里也叫「浏览器模式」「网页版」「云端」；dev 右上角切换器选 **Edge**。

> **edge 不是 Next.js 的 Edge Runtime，也不是微软 Edge 浏览器。** 它只是「线上、无盘」这个构建目标的名字，API 仍运行在 Node.js runtime。

## 4. plugin

往游戏的 `js/plugins/` 写入 Chaya 插件，游戏启动时自动加载：

- `ChayaLoader`：加载器，负责加载其余 Chaya 插件。
- `ChayaLog` / `ChayaTrans` / `ChayaBoost` / `ChayaEdit` / `ChayaAgent`：日志运行时、局内翻译、全局加速、运行时修改（局内 GameEdit 面板）、Agent 桥。
- 插件清单以 `plugins/manifest.json` 为准。
- `ChayaEnv`：连接配置（连哪个服务、是否开启插件 MCP 等），由安装方写入。

插件由 local 或 edge 的「安装插件 / 更新插件」写入；装好以后，**不开控制台也能用**：

- 局内 GameEdit 面板照常工作。
- 没有 local 服务时，ChayaAgent 在本机开插件 MCP 网关（`http://127.0.0.1:39271/mcp`），Agent 可直接连游戏；有 local 服务时由 local 占用，插件不再开。

插件只能做游戏进程里能完成的事（局内实时、插件工具），游戏库、装壳、启动游戏这类仍需 local。

## 5. 三者关系

| 场景                      | 控制台 | 游戏内 | 游戏与控制台的通道          |
| ------------------------- | ------ | ------ | --------------------------- |
| 本机开发 / 本机使用 / App | local  | plugin | ChayaAgent 长轮询本机服务   |
| 线上网页                  | edge   | plugin | WebRTC 数据通道             |
| 只打开游戏，不开控制台    | 无     | plugin | 无；Agent 直连插件 MCP 网关 |

## 6. 旧叫法对照

历史文档和代码里还有这些叫法，遇到时按下表换算：

| 看到的叫法                                                   | 指的是 |
| ------------------------------------------------------------ | ------ |
| server、服务端模式、本机服务、本地 MCP、`local` / `app` 形态 | local  |
| vercel、浏览器模式、网页版、云端、`browserMode`、Edge MCP    | edge   |
| 插件 MCP、局内、游戏内、ChayaAgent 网关                      | plugin |

构建目标（`server` / `edge` / `dev`）、服务形态（`local` / `app` / `vercel`）是实现层面的细分，判定逻辑见 [deployment-platforms.md](./technical/deployment-platforms.md) §2；沟通时只说 local / edge / plugin。

## 7. 修订

| 日期       | 内容                                          |
| ---------- | --------------------------------------------- |
| 2026-10-05 | 初稿：定义 local / edge / plugin 三种运行模式 |
