# 游戏插件子模块

MV/MZ 与 RGSS 独立构建、独立输出；根脚本只负责调度，不合并两套运行时。

| 子模块 | 源码与入口                                        | 构建                      | 产物         |
| ------ | ------------------------------------------------- | ------------------------- | ------------ |
| MV/MZ  | `mv/src/`，多个既有插件入口                       | `pnpm build:plugins:mv`   | `mv/dist/`   |
| RGSS   | `rgss/src/entry.tsx`、`rgss/*.rb`、`rgss/native/` | `pnpm build:plugins:rgss` | `rgss/dist/` |
| 共用   | `shared/`，无引擎状态的 UI、样式和声明            | 由两个子模块各自打包      | 无独立运行时 |

`pnpm build:plugins` 同时构建两套，`pnpm build:plugins:dev` 同时 watch；可以分别运行两个子模块的 `build.mjs --watch`。
每套子模块拥有自己的 `vite.config.mjs`、`tsconfig.json` 和 `manifest.json`，互不清理对方的 dist。
`pnpm typecheck:plugins` 依次检查两个项目；MV 安装、摘要、热更新与 Electron 打包读取 `mv/manifest.json`、`mv/dist/`。

`pnpm dev` 会同时启动 `rgss-sync`：RGSS Ruby 与 `rgss/dist/` 变化后自动同步到当前安装的游戏，无需手动重装。游戏未运行时执行完整安装；游戏运行且 bridge 已连接时，只同步 `bridge.rb` 可重新 `load` 的 Ruby，由游戏内循环自动重载。`Scripts.rvdata2`、overlay/native 资源及其他非热重载 Ruby 不会覆盖运行中的文件，而是在游戏退出后自动完整安装。

RGSS 前端只通过原生 JSON 桥访问 Ruby，不导入 MV 的游戏全局对象或控制器。外部控制台走 WebRTC；本机启动凭据通过原生初始化脚本注入，Edge 信令请求使用连接令牌。

macOS 构建还会用 Xcode Command Line Tools 编译 WKWebView 宿主动态库；无额外监听端口或网络转发进程。
当前原生宿主实现为 macOS。Windows WebView2 宿主及 Windows RGSS 注入尚未实现，不应宣称已支持。
游戏暂时无法启动时，可运行 RGSS 网关 Jest 测试与真实 Ruby 适配器测试；这些测试不替代窗口挂载、输入、全屏等真机验证。

`pnpm test:rgss:native` 在 macOS GUI 登录会话中创建临时测试窗口，验证真实 WKWebView 挂载、配置注入、双向 JS 桥、DataChannel 传输与区域 hit-test，不需要安装游戏或启动服务。测试窗口自动关闭。
