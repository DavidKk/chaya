# Chaya：是什么与如何安装

Chaya 是 RPG Maker MV / MZ 游戏的本机工具箱：管理游戏库、给游戏装 NW.js 壳、注入局内插件（修改、加速、翻译）、批量补译、查看日志，并提供本机 MCP 让 Agent 直接操作游戏。

## 三种形态

| 形态         | 是什么                                 | 能做                                                | 不能做                                                     | 适合               |
| ------------ | -------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| **Edge**     | 网页版 `https://chaya-gray.vercel.app` | 浏览器授权游戏目录后写入插件与壳、下载 App          | 启动游戏进程、共享翻译库、本地模型、完整 MCP（仅局内工具） | 不想装软件、先试试 |
| **本地 dev** | 在本机用 Node 跑源码（`pnpm dev`）     | 全部能力：游戏库、一键启动、补译、翻译库、日志、MCP | —                                                          | 开发者、要改代码   |
| **App**      | 桌面应用（macOS / Windows）            | 与本地 dev 相同，双击即用，数据存在系统应用目录     | —                                                          | 日常使用（推荐）   |

选择建议：日常玩和翻译用 **App**；要让 Agent 控制游戏用 **App 或本地 dev**；只想临时给游戏装插件用 **Edge**。

## App 安装（推荐）

1. 打开 Chaya 首页的下载区，按电脑选择：Apple 芯片（M 系列）、Intel Mac、Windows x64。页面会自动标出推荐项。
2. **macOS 推荐一行命令安装**（不会出现「已损坏，无法打开」）：打开「终端」粘贴并回车

   ```bash
   /bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
   ```

3. macOS 手动安装：解压 zip，把 `Chaya.app` 拖进「应用程序」。若提示「已损坏」，执行 `xattr -cr /Applications/Chaya.app` 后再打开；或右键 App →「打开」→「打开」。
4. Windows：解压 zip，运行 `Chaya.exe`。
5. App 启动后会打开控制台窗口，地址固定为 `http://127.0.0.1:3927`。

## 本地 dev 安装

前置：Node ≥ 22.19、pnpm 9。

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev          # 本机模式，监听 localhost:3000
```

- 打开 `http://localhost:3000` 即可使用，无需登录。
- 其他启动方式：`pnpm dev:lan`（局域网可访问）、`pnpm dev:app`（带 Electron 窗口，等同 App 形态）。要预览 Edge 行为，在 `pnpm dev` 右上角 dev 切换器选 **Edge**。
- 局内插件改动由 `pnpm dev` 自动重新构建，游戏会热更新。

## Edge 使用

1. 用 **Chrome 或 Edge 浏览器** 打开 `https://chaya-gray.vercel.app`（Safari / Firefox 不支持目录授权）。
2. 进入游戏库，选择本地游戏目录（含 `www` 或 `index.html`），按提示授权读写。
3. 网页会把插件与壳写进游戏目录；之后在本机双击启动游戏（网页不能启动进程）。
4. 共享翻译库、整作补译等需要本机磁盘的能力在 Edge 不可用，请改用 App 或本地 dev；游戏打开时 Agent 仍可经游戏内 MCP 网关 `http://127.0.0.1:39271/mcp` 使用局内工具。

## 授权与安全

- 本地 dev 和 App 没有登录；API 只接受来自 localhost、IP 地址或 `CHAYA_PUBLIC_ORIGIN` 的同源请求。Edge 也没有登录。
- 游戏插件使用每次启动生成的启动 token，只能访问自己的游戏会话。

## 常见问题

| 问题                   | 处理                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| macOS 提示「已损坏」   | 用上面的一行命令安装，或 `xattr -cr /Applications/Chaya.app`                       |
| 接口返回 401           | 用 `localhost` 或 IP 地址打开控制台；自定义域名需设置 `CHAYA_PUBLIC_ORIGIN` 后重启 |
| 3927 / 3000 端口被占用 | 关闭其他 Chaya App / dev 实例后重启（App 也可用 `PORT` 环境变量换端口）            |
| MCP 端口 39271 被占用  | 在游戏内「集成 → MCP」页改端口，再在 Agent 中改成新地址                            |
| Edge 无法选择目录      | 换 Chrome / Edge 浏览器                                                            |
