[![中文](https://img.shields.io/badge/%E6%96%87%E6%A1%A3-%E4%B8%AD%E6%96%87-green?style=flat-square&logo=docs)](https://github.com/DavidKk/chaya/blob/main/README.zh-CN.md) [![English](https://img.shields.io/badge/docs-English-green?style=flat-square&logo=docs)](https://github.com/DavidKk/chaya/blob/main/README.md) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen?style=flat-square&logo=node.js)](https://nodejs.org/)

# Chaya

Chaya 是面向 **RPG Maker** 的本机优先工具台：翻译（抽取、补译、实时 / 字幕）、局内修改（金钱、道具、变量、角色），以及共用 NW.js 壳启停——控制台与局内插件同一套。

三种运行形态：

| 形态            | 方式                                                    | 磁盘能力                                                   |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| **Local**       | 本机 Node，贴着游戏目录跑                               | 完整（绑定、装壳、插件、缓存）                             |
| **Toolkit App** | Electron + Next（`CHAYA_SERVICE=app`）                  | 完整                                                       |
| **Edge**        | Vercel / 浏览器（`VERCEL=1` 或 `CHAYA_SERVICE=vercel`） | 服务端无盘——在 Chrome 里用 File System Access API 准备游戏 |

结构对齐 MagickMonkey / [vercel-web-scripts](https://github.com/DavidKk/vercel-web-scripts)：Next.js UI + `plugins/` 游戏脚本。

## 特点

- **游戏库** — 多作绑定，壳 / 插件 / 窗口状态一目了然。
- **翻译管线** — 抽取、缺词补译、共享库；游玩时可实时或字幕翻译。
- **游戏修改** — 金钱道具变量、角色技能、运行开关与快捷键；控制台与局内同步。
- **数据本机** — local / app 下译文与工具数据留在本机（不落在 Edge 服务器上）。

## 部署到 Vercel（Edge）

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FDavidKk%2Fchaya)

在 Vercel 上会强制 **edge** 形态（`VERCEL=1`）：云端只提供介绍页 / 控制台 UI；装壳与写入游戏目录发生在**浏览器**（Chromium + 目录授权），而不是服务器磁盘。

1. 将 [DavidKk/chaya](https://github.com/DavidKk/chaya) 导入 Vercel（或点上方按钮）。
2. 框架选 **Next.js**；构建命令：`pnpm build`（先 `build:plugins` 再 `next build`）。
3. 部署后打开站点：`/` 为产品页，**打开控制台** 进入 `/game`。
4. 在本机用 Chrome / Edge 授权游戏目录并完成准备。

本地模拟 edge（无需 Vercel 账号）：

```bash
pnpm i
pnpm dev:edge   # CHAYA_SERVICE=vercel — DiskOps 接口返回 501
```

## 构建应用

桌面 Toolkit（Electron）+ Next 的 **app** 形态：

```bash
pnpm i
pnpm build          # 插件 → plugins/dist，再 next build
pnpm start          # 生产 Next，监听 127.0.0.1:3927
pnpm electron:open  # 对接该服务打开 Electron（CHAYA_SERVICE=app）
```

日常桌面开发（Next + 插件监听 + Electron 一起起）：

```bash
pnpm dev:app
```

安装包由 electron-builder 产出：

```bash
pnpm dist:mac   # .dmg（x64 + arm64）
pnpm dist:win   # NSIS .exe（x64）
```

GitHub Actions：[`.github/workflows/build-app.yml`](.github/workflows/build-app.yml) 在 `v*` 标签与手动触发时构建；打 tag 会发布 [GitHub Release](https://github.com/DavidKk/chaya/releases) 并挂上安装包。

## 本地运行

需要 **Node.js ≥ 22.19**（使用 `node:sqlite`）和 **pnpm**。

```bash
pnpm i
pnpm dev            # local 形态，127.0.0.1:3927 + 插件 watch
```

请用终端打印的**授权链接**打开控制台（HttpOnly 会话）。不要把链接分享给无关人员。

| 命令            | 用途                                 |
| --------------- | ------------------------------------ |
| `pnpm dev`      | 本机控制台（仅回环）                 |
| `pnpm dev:lan`  | 开放局域网，供其他设备 / VM          |
| `pnpm dev:app`  | Toolkit App（Next + Electron）       |
| `pnpm dev:edge` | 本地模拟 Edge                        |
| `pnpm ok:ci`    | 格式检查、lint、类型、测试、完整构建 |

GitHub Actions：[CI](.github/workflows/ci.yml) 在 `main` / PR 跑 `pnpm ok:ci`。[Build App](.github/workflows/build-app.yml) 在 `v*` 标签（或手动触发）打安装包，并发布 [GitHub Release](https://github.com/DavidKk/chaya/releases)（附带 `.dmg` / `.exe`）。

常用环境变量：

- `CHAYA_SERVICE` — `local` \| `app` \| `vercel`（存在 `VERCEL=1` 时无效）
- `CHAYA_AUTH_TOKEN` — 管理令牌（local / app 未设时会写入 `data/access/token`）
- `CHAYA_API_LAN=1` — 向局内插件广播局域网 API 根

开局会写入 `js/plugins/ChayaEnv.js`，并向 `/api/runtime/heartbeat` 心跳。升级插件后请从控制台重新开局。

## 目录结构

```text
chaya/
  app/ components/ lib/   Next UI 与共享辅助
  services/               game / runtime / translate / extract / log
  plugins/                局内脚本（Vite IIFE → plugins/dist）
  electron/               Toolkit App 主进程
  data/                   本机工具数据（不入库）
```

## 许可证

[MIT](./LICENSE)
