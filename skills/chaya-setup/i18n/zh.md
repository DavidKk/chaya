# Chaya：是什么与如何安装

Chaya 是 RPG Maker MV / MZ 游戏的本机工具箱：管理游戏库、给游戏装 NW.js 壳、注入局内插件（修改、加速、翻译）、批量补译、查看日志，并提供本机 MCP 让 Agent 直接操作游戏。

## 三种形态

| 形态         | 是什么                                 | 能做                                                | 不能做                                  | 适合               |
| ------------ | -------------------------------------- | --------------------------------------------------- | --------------------------------------- | ------------------ |
| **Edge**     | 网页版 `https://chaya-gray.vercel.app` | 浏览器授权游戏目录后写入插件与壳、下载 App          | 启动游戏进程、共享翻译库、本地模型、MCP | 不想装软件、先试试 |
| **本地 dev** | 在本机用 Node 跑源码（`pnpm dev`）     | 全部能力：游戏库、一键启动、补译、翻译库、日志、MCP | —                                       | 开发者、要改代码   |
| **App**      | 桌面应用（macOS / Windows）            | 与本地 dev 相同，双击即用，数据存在系统应用目录     | —                                       | 日常使用（推荐）   |

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
pnpm dev          # 本机模式，监听 127.0.0.1:3927
```

- 终端会打印 **授权链接**（`http://127.0.0.1:3927/api/access?token=…`），用它打开控制台；token 也保存在 `data/access/token`。
- 其他启动方式：`pnpm dev:lan`（局域网可访问）、`pnpm dev:app`（带 Electron 窗口，等同 App 形态）、`pnpm dev:edge`（本机模拟 Edge，用于测试）。
- 局内插件改动由 `pnpm dev` 自动重新构建，游戏会热更新。

## Edge 使用

1. 用 **Chrome 或 Edge 浏览器** 打开 `https://chaya-gray.vercel.app`（Safari / Firefox 不支持目录授权）。
2. 进入游戏库，选择本地游戏目录（含 `www` 或 `index.html`），按提示授权读写。
3. 网页会把插件与壳写进游戏目录；之后在本机双击启动游戏（网页不能启动进程）。
4. 共享翻译库、整作补译、MCP 等需要本机磁盘的能力在 Edge 不可用，请改用 App 或本地 dev。

## 授权与安全

- 控制台和 API 需要管理 token；授权链接只在本机打开，不要分享。
- 游戏插件使用每次启动生成的启动 token，只能访问自己的游戏会话。

## 常见问题

| 问题                   | 处理                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| macOS 提示「已损坏」   | 用上面的一行命令安装，或 `xattr -cr /Applications/Chaya.app`            |
| 打开控制台显示需要授权 | 用终端里的授权链接打开；App 会自动带上授权                              |
| 3927 端口被占用        | 关闭其他 Chaya App / dev 实例后重启（App 也可用 `PORT` 环境变量换端口） |
| Edge 无法选择目录      | 换 Chrome / Edge 浏览器                                                 |
