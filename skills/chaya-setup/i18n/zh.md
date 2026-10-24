# Chaya：安装与运行方式

Chaya 管理 RPG Maker 游戏、NW.js 壳、插件、修改、翻译、日志和 MCP。

## 选择方式

- **local**：App（macOS / Windows）或本地开发，提供完整游戏库、启动、本地翻译与 MCP；App 数据位于系统应用目录。
- **cloud**：打开 `https://chaya-gray.vercel.app`，用 Chrome / Microsoft Edge 授权含 `www` 或 `index.html` 的目录，写入插件与壳，再自行启动游戏。网页不能启动进程，也不提供本地模型或本机服务的共享翻译库。
- **plugin**：在游戏内运行，不开控制台也可使用；MCP 提供局内操作、修改、翻译、缓存、日志与游戏技能，不提供游戏库管理、启动、batch 或 eval。Cloud 补译通过在线游戏的 `chaya_translate_job`。

## 安装 App / 本地开发

主页下载区选择 Apple Silicon、Intel Mac 或 Windows x64。macOS 终端安装：

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

手动安装：解压后将 `Chaya.app` 拖入应用程序；提示“已损坏”时执行 `xattr -cr /Applications/Chaya.app`，或右键 → 打开 → 打开。Windows 解压后运行 `Chaya.exe`。App 默认控制台 `http://127.0.0.1:3927`。

开发需 Node ≥ 22.19、pnpm 9：

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

访问 `http://localhost:3000`；`pnpm dev:lan` 开放局域网，`pnpm dev:app` 带 Electron。开发切换器为 Local / Cloud，源文件变化时重建插件。

## 访问与排错

无需登录；本地 API 仅接受 localhost、IP 或 `CHAYA_PUBLIC_ORIGIN` 的同源请求。自定义域名报 401 时设置该变量并重启。插件使用限于自身会话的启动 token，更新插件后重启游戏。3000 / 3927 被占用时退出其它实例，或设置 App 的 `PORT`。

MCP 默认 `http://127.0.0.1:39271/mcp`；在游戏内“集成 → MCP”改端口后同步客户端。本机服务运行时统一网关转发至本机 MCP。Cloud 无法选目录时使用桌面 Chrome / Microsoft Edge 并授权；准备后在电脑双击 `Chaya.app` / `Chaya`。
