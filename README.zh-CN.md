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

本地模拟 edge（无需 Vercel 账号）：`pnpm dev` 后在右上角 dev 切换器选 **Edge**；DiskOps 接口返回 501。

Edge 没有登录，也没有服务端 MCP。外部 Agent 连接统一地址 `http://127.0.0.1:39271/mcp`，由打开的游戏（或本机服务）提供，见 [docs/mcp-plugin.md](docs/mcp-plugin.md) 与 [docs/mcp-edge.md](docs/mcp-edge.md)。

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

macOS 安装包为 **ad-hoc 签名**（无 Apple 开发者账号）。将 **Chaya** 拖入「应用程序」后：

1. **右键 → 打开 → 打开**（只需一次），一般即可用。
2. 若仍提示「已损坏」，再执行：

```bash
xattr -cr /Applications/Chaya.app
```

Windows：若 SmartScreen 拦截安装包，选 **更多信息 → 仍要运行**。

## 本地运行

需要 **Node.js ≥ 22.19**（使用 `node:sqlite`）和 **pnpm**。

```bash
pnpm i
pnpm dev            # local 形态，localhost:3000 + 插件 watch
```

打开 `http://localhost:3000` 即可使用。local / App 形态没有登录：API 只接受来自 localhost、局域网 IP 或 `CHAYA_PUBLIC_ORIGIN` 的同源请求；MCP 也无需授权，Agent 连接 `http://127.0.0.1:39271/mcp`（也可直连本机服务自身的 `http://127.0.0.1:3000/api/mcp`，见「集成 → MCP」；网关端口在游戏内修改）。

| 命令           | 用途                                 |
| -------------- | ------------------------------------ |
| `pnpm dev`     | 本机控制台（仅回环）                 |
| `pnpm dev:lan` | 开放局域网，供其他设备 / VM          |
| `pnpm dev:app` | Toolkit App（Next + Electron）       |
| `pnpm ok:ci`   | 格式检查、lint、类型、测试、完整构建 |

GitHub Actions：[CI](.github/workflows/ci.yml) 在 `main` / PR 跑 `pnpm ok:ci`。[Build App](.github/workflows/build-app.yml) 在 `v*` 标签（或手动触发）打安装包，并发布 [GitHub Release](https://github.com/DavidKk/chaya/releases)（附带 `.dmg` / `.exe`）。

常用环境变量：

- `CHAYA_SERVICE` — `local` \| `app` \| `vercel`（存在 `VERCEL=1` 时无效）
- `CHAYA_AUTH_TOKEN` — 内部管理令牌，供脚本与 MCP 进程内调用，不能用来登录浏览器（local / app 未设时会写入 `data/access/token`）
- `CHAYA_PUBLIC_ORIGIN` — 本机 API 额外接受的主机名（如局域网域名）
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

## 免责声明

Chaya 为开源免费提供的中立技术工具，仅提供翻译、修改及 AI 辅助等功能，除用户自选的第三方服务外均在用户自有设备上运行；与 Gotcha Gotcha Games、株式会社 KADOKAWA 及任何权利人均无关联，亦未获其授权或背书。「RPG Maker」为其权利人的商标，本项目仅为说明兼容范围而使用。

- **合法使用**：仅限对合法取得的游戏使用，并遵守适用法律。作品权利人明确禁止翻译、修改或解析的，不得对该作品使用本工具。
- **不提供分发服务**：开发者不提供任何形式的分发、托管、上传、共享或下载服务，范围包括游戏本体、翻译补丁、翻译缓存、经翻译的数据文件（如 JSON）及经修改的游戏。生成的数据仅保存于用户本地设备。任何分发行为均属用户的独立行为，相关责任由用户自行承担。
- **第三方服务**：使用云端翻译或 AI 引擎时，游戏文本将依相应服务提供者的条款传输至该服务提供者。
- **修改**：修改功能可能导致存档损坏，请事先备份，且不得用于联网或排行场景。
- **不规避技术保护措施**：本工具不提供、也不会加入解密受保护资源、破解存档、规避 DRM 或解锁付费内容等功能。
- **无担保与用户责任**：本工具按「现状」提供。在法律允许的最大范围内，开发者不对使用本工具产生的任何损失承担责任；因用户违约引起的索赔，由用户负责赔偿。

完整声明（中文 / EN / 日本語 / 한국어）见应用内 `/disclaimer` 页面。权利人可通过 GitHub Issues 与开发者联系。

## 隐私

Chaya 不要求注册账号，开发者不收集可识别个人身份的信息。本机版不含遥测，设置、缓存及 API 密钥均保存在用户设备上；在线版在浏览器内本地读写游戏目录，翻译请求由用户设备直接发往所选引擎、不经开发者服务器，并使用不依赖 Cookie 的 Vercel Web Analytics 统计汇总访问量。完整内容见应用内 `/privacy` 页面。

## 许可证

Chaya 是依 [MIT 许可证](./LICENSE) 发布的开源项目，可免费使用、修改及再分发，惟须保留版权声明与许可声明。该许可仅适用于本项目，不授予对任何游戏、RPG Maker 或第三方服务的权利；所使用的第三方组件依其各自许可证发布。详见应用内 `/license` 页面。
