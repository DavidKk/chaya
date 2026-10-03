# Toolkit App（Electron）

> 外壳选型：Electron（包装本机 Next + DiskOps）。游戏仍用 NW.js，互不替代。  
> 服务形态：`CHAYA_SERVICE=app`（能力同 local，见 [service-modes.md](./service-modes.md)）

## 开发启动

```bash
pnpm i                 # 若 electron 二进制下载慢：已配置 .npmrc 镜像
pnpm dev:app           # Next(app) + plugins watch + Electron 窗口
# 或仅窗口（需已有服务在 3927，或设置 PORT）：
pnpm electron:open
```

- 窗口加载 `http://127.0.0.1:3927`（Next 默认绑 `0.0.0.0`，局域网亦可访问），窗口直接打开控制台（本机形态不登录，见 [deployment-platforms.md](./deployment-platforms.md)）
- 本机 MCP 免授权，外部 Agent 连统一地址 `http://127.0.0.1:39271/mcp`（[mcp-gateway.md](./mcp-gateway.md)）；`http://localhost:3927/api/mcp` 为兼容地址
- `pnpm dev:app` 用 3000 端口且窗口主机为 `localhost`，与 `pnpm dev` 一致
- 主进程：[`electron/main.cjs`](../../electron/main.cjs)
- 预加载：[`electron/preload.cjs`](../../electron/preload.cjs)（仅暴露 `window.chayaDesktop`）

`pnpm dev` 仍为浏览器（可用右上角 dev 切换器切到 Edge）；**App 形态用 `dev:app`**。

## 打包安装包

```bash
pnpm build:app   # Next standalone + plugins → .electron-builder/app-root
pnpm dist:mac    # release/*.dmg
pnpm dist:win    # release/*Setup*.exe
```

- 配置：[`electron-builder.yml`](../../electron-builder.yml)
- 组装：[`scripts/prepare-electron-app.mjs`](../../scripts/prepare-electron-app.mjs)
- CI：[`.github/workflows/build-app.yml`](../../.github/workflows/build-app.yml)（`v*` / `workflow_dispatch`）
- 安装包内 Next 走 Resources/`app-root`；可写数据在 `userData`（`CHAYA_DATA_DIR` / `CHAYA_LOGS_DIR`）

当前 CI 用 **ad-hoc 签名**（`mac.identity: null` + `afterPack` 执行 `codesign --sign -`，无 Apple Developer ID / 不公证），避免未签名 + 隔离导致的「已损坏」；首启仍可能需右键打开。有正式证书时设 `identity` 即可（`afterPack` 验签通过后不会覆盖）。

打包态配置写在 `CHAYA_DATA_DIR`（`userData/data`），不写进 `Resources/app-root`。

## 环境变量

| 变量                        | 说明                                                     |
| --------------------------- | -------------------------------------------------------- |
| `CHAYA_SERVICE`             | Electron 路径默认 / 强制为 `app`                         |
| `CHAYA_ELECTRON_EXTERNAL=1` | 不自行 spawn Next（由 concurrently 拉起）                |
| `CHAYA_ELECTRON_BUILD=1`    | `next build` 产出 standalone（仅打包用）                 |
| `CHAYA_ROOT`                | 覆盖工具根（安装包指向 Resources/app-root）              |
| `CHAYA_DATA_DIR`            | 覆盖本机数据目录（安装包指向 userData/data）             |
| `CHAYA_LOGS_DIR`            | 覆盖日志目录（安装包指向 userData/logs）                 |
| `PORT` / `CHAYA_PORT`       | 默认 `3927`                                              |
| `CHAYA_HOST`                | Electron 打开窗口用的主机，默认 `127.0.0.1`              |
| `CHAYA_API_BASE`            | 写入游戏 Env 的 API 根（覆盖自动探测）                   |
| `CHAYA_API_LAN=0`           | 强制 Env 用 `http://127.0.0.1:端口`（默认优先局域网 IP） |

## 以后

- 签名 / 公证 / `electron-updater` 远程升级
- App 数据目录与壳缓存策略细化
