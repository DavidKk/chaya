# plugins

局内游戏插件源码。用 **Vite** 打成自包含 IIFE（`dist/*.js`）。

**加载方式：** 游戏内只落盘 `ChayaEnv` + `ChayaLoader`；Loader 启动时从本机 Chaya
`GET /api/plugins/:name.js` 拉取跟踪插件，失败则回退 `js/plugins/*.js` 磁盘缓存。

日常开发：`pnpm dev` 会先全量 `build:plugins`，再并联 Next 与 plugins watch；
改 `plugins/src` 后自动重打 `dist`，**重启游戏**即可吃到新包（不必反复安装 Loader）。

```text
plugins/
  src/
    chaya-loader.ts          → ChayaLoader.js
    entry.ts                 → ChayaLog.js
    game-boost.ts            → ChayaBoost.js
    cheat/                   → ChayaEdit.js
      index.ts               入口
      ui/                    面板壳（App / mount / host / css）
      runtime/               局内作弊与运行开关
      session/               会话、落盘、远程桥
      console/               控制台 API / 热键 / 道具标签
    translator/              → ChayaTrans.js
      index.ts               入口
      lookup/                查表增强
      patch/                 DB / 事件写回与分片队列
      engine/                RM 绘制挂钩
    helpers/
      index.ts               公共 barrel
      env/                   API·Log URL、ChayaEnv 补注入
      net/                   http / logger
      game/                  身份、WebRTC、presence、窗口尺寸
      node/                  NW fs/path
      ui/                    Shadow / DOM / 错误条
  dist/
  vite.config.mjs
  build.mjs
```

游戏内容根：

```text
chaya/translate/   seed · cache · switches …
chaya/config/      game-edit.json
```

有服务：远程共享库 → 本游戏本地 → 翻译 → 双写。离线：仅本游戏本地。

ChayaEdit UI：React `createRoot`，与控制台 `/edit` 共用 `components/game-edit` + `components/sk`（无 Next 依赖）。Shadow 宿主仅作样式隔离。

开发（`pnpm dev` / `pnpm dev:app` / `pnpm dev:edge`）：共用插件 watch 和 `/api/plugins/stream` SSE。ChayaLoader 先确认服务处于开发环境，再订阅构建通知，按依赖顺序热替换插件；首次连接及重连会核对版本，断线期间的改动也会补上。游戏先启动、开发服务后启动也会自动连接。生产服务不开放热替换流。

ChayaEdit 会先卸载旧 React 挂载点再挂载，面板开着会自动重开；ChayaTrans 会清理旧钩子、文件监听及翻译请求，不刷新游戏页。旧版 Loader 需要更新安装并在下一次启动游戏时加载一次，此后的普通插件和共用 UI 改动无需重启游戏。Loader 自身不参与热替换。

```bash
pnpm build:plugins
pnpm build:plugins:dev   # watch
pnpm dev                # Next + plugins watch
```
