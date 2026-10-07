# 游戏存档技术文档

> 第 1–3、6 阶段已实现，第 4–5 阶段未做（见「分阶段」），更新于 2026-10-07。用户行为见 [需求文档](../game-saves.md)。RPG Maker 引擎 API 依据 MV 1.6 / MZ 1.x 公开源码整理，本仓库没有引擎源码，须在真实 MV、MZ 游戏上逐项核对，见「待验证」。

## 结构

| 职责                                 | 代码位置                                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 页面：自动存档卡片、快速存档卡片     | `components/game-saves/`，Web 入口 `app/assist/saves/page.tsx`                                                          |
| 辅助导航与局内浮层分区               | `components/input-assistance/assist-sections.ts`、`components/settings/GameEditAgentSettingsPane.tsx`                   |
| 设置、索引、条目类型、校验与轮换选择 | `lib/game/game-saves/`                                                                                                  |
| 辅助工具通道（键鼠工具与存档共用）   | `components/game-tools/transport.ts`、`plugins/src/cheat/ui/game-tool-transport.ts`                                     |
| 游戏侧命令、队列、调度               | `plugins/src/cheat/game-saves/controller.ts`                                                                            |
| 控制器依赖的游戏与环境能力           | `plugins/src/cheat/game-saves/env.ts`                                                                                   |
| 安全时刻判定                         | `plugins/src/cheat/game-saves/safety.ts`                                                                                |
| 存档内容生成、缩略图与恢复           | `plugins/src/cheat/game-saves/serialize.ts`                                                                             |
| 文件 / IndexedDB 存储与压缩          | `plugins/src/cheat/game-saves/store.ts`                                                                                 |
| 按设置分派存放位置（游戏中 / 本机）  | `plugins/src/cheat/game-saves/routed-store.ts`、`plugins/src/cheat/game-saves/app-store.ts`                             |
| 存到 Chaya 本机（本机服务）          | `app/api/game-saves/store/route.ts`、`services/game-saves/app-store.ts`                                                 |
| 游戏内提示                           | `plugins/src/cheat/game-saves/toast.ts`                                                                                 |
| 快速存档快捷键                       | `components/game-edit/run-hotkeys.ts`、`plugins/src/cheat/ui/App.tsx`                                                   |
| 游戏内迷你面板与面板快捷键           | `components/game-saves/GameSavesMiniPanels.tsx`、`components/game-tools/`、`plugins/src/cheat/ui/FloatingGameSaves.tsx` |
| 通用设置（本机服务）                 | `app/api/game-saves/settings/route.ts`                                                                                  |
| 网页与游戏消息                       | `lib/runtime/game-link-protocol.ts`                                                                                     |
| 游戏内容目录路径                     | `lib/game/content-paths.ts`                                                                                             |

页面只负责展示和发命令；保存、读档、轮换和计时全部在游戏插件里完成，网页关闭后自动存档照常运行。页面通过 `GameToolTransportContext` 取通道：Web 控制台走 GameLink，局内浮层直接调用 `window.__chayaGameSaves`。通用设置读回前（`settingsReady` 为 false）整页渲染 `GameSavesSkeleton`；读回后两张卡片始终渲染：设置区显示通用设置，任何时候都可修改；没有快照（未选择、未连接、读取中、读取失败）时只有列表区域换成空态、骨架屏或错误重试（`placeholder`），保存、清空按钮禁用。本机模式的离线只读列表属于第 4 阶段。

## 设置同步

设置是一份通用设置，所有游戏共用，`useGameSaves` 负责读写与同步：

- 存放：`localGlobal` 为真（edge、局内浮层）时存 `localStorage` 的 `chaya:game-saves:settings`；否则走 `GET/PUT /api/game-saves/settings`（`app/api/game-saves/settings/route.ts`），文件为本机数据目录下 `game-saves/settings.json`，`requireDisk` 保护，临时文件 + rename。
- 游戏目录的 `chaya/config/game-saves.json` 是副本，网页关闭后游戏按它运行。
- revision 只增不减。页面修改时新 revision 取 `max(通用, 游戏副本) + 1`，先写通用设置，已连接再发 `configure`。控制器写入 `max(当前 + 1, 传入 revision)`，所以两份 revision 保持一致；API 的 PUT 要求 `expectedRevision` 等于当前值且新 revision 更大，允许一次跳过多个版本。
- 连接后取快照：通用较新则 `configure` 下发；游戏副本较新（快照或 `saves.changed` 带来的设置）则写回通用设置。
- 已连接时调小最多个数，页面按当前列表确认删除；未连接时无法确认，连接下发后控制器照常轮换。

## 存储

游戏内容根下：

```text
chaya/config/game-saves.json           通用设置的副本（GAME_CONTENT_RELS.gameSaves）
chaya/saves/index.json                 两个列表的索引（GAME_CONTENT_RELS.gameSavesIndex）
chaya/saves/auto/auto-<id>.rpgsave.gz  自动存档内容
chaya/saves/auto/auto-<id>.jpg         自动存档缩略图
chaya/saves/quick/quick-<N>.rpgsave.gz 快速存档内容，N 为 0–9
chaya/saves/quick/quick-<N>.jpg        快速存档缩略图
```

- 目录与游戏自带的 `save/` 分开，文件名也不用 `file<N>.rpgsave`，游戏的存档界面不会扫到。条目 id 只允许 `auto-[0-9a-z]` 与 `quick-[0-9]`，直接用作文件名。
- 内容是 `JsonEx.stringify(DataManager.makeSaveContents())` 再 gzip；不复用引擎的 LZString / pako 编码，MV 与 MZ 共用一种格式。有 Node 时用 `zlib`，否则用 `CompressionStream('gzip')`。
- 写入顺序：内容写 `*.tmp` 后 `rename`，再写缩略图，最后写 `index.json`（同样先写临时文件）。轮换和删除先改索引再删文件。覆盖快速存档前先读出旧内容与缩略图，写内容或提交索引失败时写回，槽位保持保存前的存档。写入前先确认该列表的位置可用，不可用时不做序列化。
- 启动对账：索引里有、内容文件缺失的条目移除并写 `warn` 日志；目录里有、索引没有的文件（索引损坏或提交中断）用 `recoverOrphanEntry` 补成最小条目写回索引并写 `warn`：快速槽按 id 还原槽位，自动存档按 id 前段的 base36 时间还原 `savedAt`，其余元数据留空；这样它们重新出现在列表里，快速槽覆盖前也能备份；`*.tmp` 一律删除。
- 读取：只有文件或目录不存在算空；其他读取错误（权限、被占用）抛出，该位置进入 `status.offline`，避免把已有存档当作没有。`index.json` 内容损坏时先复制为 `index.json.corrupt-<时间>` 再按空索引处理。
- 无文件系统（浏览器版游戏）时改用 IndexedDB 库 `chaya-game-saves:<gameId>`（gameId 与下文本机位置的稳定标识相同；库内游戏即库 id，与旧库名一致），表 `meta`（设置与索引）、`entries`、`thumbs`；两者都没有时退回内存存储（只用于测试）。
- 设置文件不存在时使用默认值（关闭、5 分钟、30 份、快速存档快捷键关闭、两个列表都存到游戏中）。设置与索引各有 `revision`，分开递增；设置的 revision 与通用设置对齐，见「设置同步」。

### 存放位置

设置里 `autoStorage`、`quickStorage` 分别决定两个列表放在哪：`game`（默认，上面的游戏目录或 IndexedDB）或 `app`（Chaya 本机）。

- 本机位置：本机服务数据目录下 `game-saves/games/<gameId>/`，结构同游戏目录的 `chaya/saves/`（`index.json`、`auto/`、`quick/`）。gameId 取稳定标识：游戏库 id；没有时用游戏目录（`path:<gameRoot>`），浏览器版用页面地址（`url:<origin+pathname>`）。不用启动令牌，因为它每次启动都会变。不符合 `[A-Za-z0-9_-]{1,96}` 时取 sha256 前 32 位。插件经 `POST /api/game-saves/store`（`requireDisk`）读写，`writeIndex` 缺少 `entries` 数组、条目 id 缺失或与列表不符时返回 400，`readEntry` 内容文件不存在时返回 404（`ENTRY_MISSING`，不带路径）；`index.json` 内容损坏时留一份 `.corrupt-<时间>` 副本并按空索引返回，由插件对账补回条目；`op` 为 `readIndex` / `writeIndex` / `writeEntry` / `readEntry` / `readThumb` / `removeEntry` / `listEntries`，内容以 base64 传输；条目 id 用 `isGameSaveEntryId` 校验并要求与列表一致，防止越出目录。
- `RoutedSaveStore`：每处各有一份索引，控制器看到的是合并视图（自动、快速各取自当前所在位置）。写索引时每处只替换放在该处的列表，未放在该处的条目原样保留，内容未变的位置不写。切换位置不迁移存档：原处的存档保留，切回即可看到。设置副本始终写在游戏侧。
- 读取失败（本机服务未运行）的位置不写入，对应列表放进 `status.offline`；在该列表上保存、读档报「无法连接 Chaya 本机服务」，另一列表不受影响。页面 `snapshot`（含「重试」）时重读失败的位置。页面该列表显示离线空态与重试，迷你面板显示失败条。
- 非本机模式（工具设置返回 404）时「存到 Chaya 本机」选项禁用，与迷你面板开关同一判断。

### 索引

```ts
type GameSaveEntry = {
  id: string // auto-<时间戳36进制><4位随机>；quick-<N>
  list: 'auto' | 'quick'
  slot?: number // 0–9，仅 quick
  tag: 'auto' | 'manual' | 'preload' | 'quick'
  unsafe: boolean // 「仍然保存」强制保存
  savedAt: number
  playtimeFrames: number // 保存时的 Graphics.frameCount
  mapId: number
  mapName: string // $gameMap.displayName()，为空时页面显示「地图 N」
  partyNames: string[] // 最多 4 个
  versionId: number // $dataSystem.versionId
  engine: 'mv' | 'mz'
  bytes: number
  hasThumb: boolean
}

type GameSavesIndex = { version: 1; revision: number; entries: GameSaveEntry[] }
```

## 游戏侧执行

### 安全时刻

`checkSaveSafety()` 按顺序判断，第一条不满足即返回原因：

| 原因       | 判定                                                                              |
| ---------- | --------------------------------------------------------------------------------- |
| `notMap`   | `!(SceneManager._scene instanceof Scene_Map)` 或 `SceneManager.isSceneChanging()` |
| `battle`   | `$gameParty.inBattle()`                                                           |
| `event`    | `$gameMap.isEventRunning()`（自动执行与触发的事件；并行事件不计入）               |
| `message`  | `$gameMessage.isBusy()`                                                           |
| `transfer` | `$gamePlayer.isTransferring()`                                                    |
| `moving`   | `$gamePlayer.isMoving()`                                                          |
| `menu`     | `SceneManager._nextScene` 存在，或地图场景 `_menuCalling` 为真                    |

不检查 `$gameSystem.isSaveEnabled()`：游戏禁用存档的段落里定时、页面、快速存档都照常保存，这是本功能的目的之一。调度器另有三个等待原因：`idle`（挂机）、`busy`（有操作在执行）与 `offline`（自动存档的存放位置不可用）。

### 调度

控制器每 500 ms 轮询一次（`tick()`）：

1. 未开启，或 `env.active()` 为假（窗口失焦或隐藏、不在游戏中、浮层打开暂停了游戏）时不累计。
2. 累计 `Graphics.frameCount` 的增量；单次增量不在 1–600 帧之间的忽略（读档会把帧计数改回存档时的值）。按 60 帧/秒换算到间隔。
3. 到期后：有操作执行中则等待 `busy`；挂机则等待 `idle`；不安全则等待对应原因；存放位置不可用则等待 `offline`；连续 3 次轮询（跨度 1 秒）都安全时入队保存。定时保存失败后从头计时，不在每次轮询时重试。
4. 挂机判定：在游戏文档捕获阶段监听可信的 `keydown`、`pointerdown`、`wheel`、`touchstart`，并比较地图编号与玩家坐标。自上次自动存档以来两者都没变化时不保存。手柄输入通过坐标变化间接覆盖。
5. 进入自动列表的保存（定时、页面「立即存档」）与读档成功都会清零；修改间隔、开关自动存档也清零；快速存档不影响。
6. 等待原因变化时推送 `saves.status` 并各写一条日志；另外每 5 秒推送一次状态。状态带 `counting`（开启且 `env.active()`）：为真时页面在两次推送之间本地递减倒计时，为假时显示「计时暂停 · 剩 …」且不递减，避免游戏失焦时倒计时来回跳。

### 保存流程

保存、读档、删除、清空进入同一个 Promise 队列串行执行。读档进行中拒绝所有保存（快捷键提示「正在读档」）；同一快速槽或定时存档已在排队时，重复请求被拒绝。`configure`（校验 revision、写设置、切换位置、轮换）与 `snapshot` 触发的位置重读也排进队列，不受读档限制，不会与写入交错；并发的两次 `configure` 因此按顺序校验 revision。页面下发 `configure` 遇到版本过期时取一次快照，本地仍较新则按最新版本重发。

1. 安全检查。页面请求不安全时回复 `code: 'unsafe'` 与原因，网页确认后带 `force: true` 重发；快捷键不安全时只在游戏内提示原因，不写入。
2. 截缩略图：`SceneManager.snap()` 缩放到宽 160 px，导出 JPEG（质量 0.7），在显示提示之前截取。
3. 显示「存档中」（所有来源都显示）。
4. 生成内容：记下 `$gameSystem._saveCount`，调用 `$gameSystem.onBeforeSave()`，再把 `_saveCount` 改回原值，然后 `makeSaveContents()` → `JsonEx.stringify` → gzip。
5. 写内容与缩略图，更新索引；自动列表随后轮换：从最早的开始删。索引提交失败时，覆盖快速槽写回旧内容，新条目删除刚写的内容文件。定时存档失败时从头计时；但若是入队后才变得不可保存（`unsafe`），保留已累计的时间，等安全后再存。
6. 提示结果，写日志（含来源与耗时），推送 `saves.changed`。

### 读档流程

1. 找不到条目：快速槽回复「槽 N 为空」。版本不一致（条目 `versionId` 与当前 `$dataSystem.versionId` 不同）：页面确认后带 `allowVersionMismatch: true`；快捷键直接拒绝并提示「存档来自其他版本，请在页面加载」。
2. 读取并解压内容。此前任何失败都不会改动游戏。
3. 若已在游戏中，在内存里生成当前进度，仅用于恢复失败时回滚，不写入列表。
4. `env.beforeLoad()` 关闭浮层（同时恢复游戏循环），然后恢复：`createGameObjects()` → `extractSaveContents()` → `correctDataErrors?.()` → `versionId` 变化时 `reserveTransfer` + `requestMapReload` → 冻结当前场景（`update` 置空、`isBusy` 返回假，避免旧场景用新对象再跑一帧）→ 停止 ME、SE → `SceneManager.goto(Scene_Map)` → `$gameSystem.onAfterLoad()`。
5. 恢复抛错：用内存中的进度按同样流程恢复，不改列表，回复错误。备份也恢复失败时写 `fail` 日志，提示从游戏存档或列表重新读取。
6. 成功：`env.afterLoad()`（`markGameEditNeedReapply()` 重新套用修改锁定，键鼠工具 `stopAll()`），按刚完成自动存档处理（`markAutoSaved`：清零计时、清除操作标记、记录进度指纹），读档不写任何条目，下一次自动存档要等满一个间隔且期间有操作或进度变化。旧版本留下的 `preload` 条目照常显示「读档前备份」标签。

本功能不经过 `DataManager.loadGame`，所以 `persist.ts` 的读档钩子和 `agent/history.ts` 的读档记录都不会触发；前者由 `afterLoad` 显式补上。

### 游戏内提示

`toast.ts` 渲染独立元素 `#chaya-save-status`，外观与实时翻译的 `#chaya-translation-status` 一致：右下角圆形图标展开为文字，蓝色转圈表示进行中，绿色 ✓ 成功（2 秒后收起），红色 × 失败（4 秒后收起）；「存档中」至少显示 400 ms 再切换结果；不拦截鼠标；遵循 `prefers-reduced-motion`。

翻译提示由另一个插件包渲染，两者不共享模块状态。存档提示读取翻译提示的 DOM：翻译提示可见时叠在它上方，翻译提示移到顶部（或指针靠近右下角）时一起移到顶部。

## 协议

```ts
type GameSavesMessage =
  | ({ type: 'saves.cmd'; reqId: string; gameId: string } & GameSavesOp)
  | { type: 'saves.reply'; reqId: string; ok: true; snapshot: GameSavesSnapshot; result?: string | null }
  | { type: 'saves.reply'; reqId: string; ok: false; error: string; code?: GameSavesErrorCode; reason?: SaveWaitReason }
  | { type: 'saves.status'; gameId: string; status: GameSavesStatus }
  | { type: 'saves.changed'; gameId: string; snapshot: GameSavesSnapshot }

type GameSavesOp =
  | { op: 'snapshot' }
  | { op: 'configure'; settings: GameSavesSettings; expectedRevision: number } // 设置的 revision
  | { op: 'save'; target: 'auto'; force?: boolean }
  | { op: 'save'; target: 'quick'; slot: number; force?: boolean; source?: 'page' | 'hotkey' }
  | { op: 'load'; entryId: string; allowVersionMismatch?: boolean; source?: 'page' | 'hotkey' }
  | { op: 'delete'; entryId: string }
  | { op: 'clear'; list: 'auto' | 'quick' }
  | { op: 'thumb'; entryId: string } // result 为 JPEG data URL
```

- 每个成功回复都带完整快照（设置、索引、状态、当前 `versionId`），页面直接替换。
- 控制器校验 `gameId`，按 `reqId` 缓存最近 200 个回复，重复请求返回同一结果。
- `handle()` 服务 GameLink 客户端并记下它的回传通道；`request()` 服务局内浮层，不占用该通道。任何写操作都推送 `saves.changed` 给 GameLink 客户端，并派发窗口事件给浮层，两端保持一致。
- 缩略图不随快照下发；页面按「条目 id + 保存时间」缓存，覆盖保存后自动换新。

## 快速存档快捷键

- `run-hotkeys.ts` 新增 `HotkeyKind` `save`，id 为 `save:quick:N` 与 `load:quick:N`，分组「快速存档」共 20 项；`HotkeyTarget.labelParams` 传入槽号。
- 默认值由 `defaultHotkeyChord()` 给出（保存 `Ctrl+N`，读取 `Alt+N`），在快捷键页作为全局一列的占位显示。`effectiveHotkeys()` 最先放入未设置项的默认值，玩家的任何绑定都会覆盖同一组合，冲突时默认值自动让位。快捷键表会丢弃空串，无法表示「已清除」；清除默认绑定的方式是关闭该项的开关（`isHotkeyDisabled`）。
- 按键识别：`formatKeyChord()` 对主键盘数字改用 `ev.code`（`Digit3` → `3`），使 macOS 上 `⌥3`（`key` 为 `£`）、`Shift+3`（`#`）也能匹配；字母只在按住 Alt 时按 `ev.code` 取，其余跟随键盘布局，避免改变 AZERTY 等布局的已有绑定。小键盘数字的 `key` 也是数字，与主键盘数字视为同一按键。
- 开关：设置 `quickEnabled`（「开启快速存档」，默认关闭）。关闭或设置尚未读取完成时，`App` 对 `save` 类型直接跳过，不 `preventDefault`，按键交给游戏；`controller.hotkey()` 也再判断一次；`saveQuick` 拒绝写入（「快速存档未开启」），页面「保存」禁用。加载、删除、清空已有槽位不受影响。槽位行不显示快捷键，按键示例只在设置区说明中出现。
- 跳转：「配置快捷键」先调用 `requestHotkeyGroupFocus('edit.groupQuickSave')` 再跳转；`GameEditHotkeysPane` 挂载后的下一帧 `takeHotkeyGroupFocus()`，把对应分组 `scrollIntoView`，滚动后边框闪三次（关键帧 `chaya-ring-flash`，Web 定义在 `app/globals.css`，浮层定义在 `plugins/src/cheat/ui/overlay.css`）。Web 路由与局内浮层切分区都在同一页面内，用模块状态传递，不依赖 URL。
- 执行：插件 `App` 的全局 keydown 处理匹配到 `save` 类型且 `quickHotkeysEnabled()` 为真时调用 `__chayaGameSaves.hotkey()`；面板打开或关闭都生效，焦点在输入框时不响应，跳过 `ev.repeat`。
- 快速存档卡片显示每个槽的有效快捷键：局内浮层取本游戏快捷键缓存，Web 取本地存储。

## 游戏内迷你面板

需求见需求文档 §6.3、§6.4。四个迷你面板（迷你地图、旅伴、自动存档、快速存档）共用 `FloatingToolPanel` 与工具设置。

- **工具设置**：`lib/game-agent/tool-settings.ts` 的 `ToolSettings` 新增 `autoSavePanelEnabled`、`quickSavePanelEnabled`，默认 `false`，由 `normalizeToolSettings` 补齐。仍走 `GET/PUT /api/integration/game-agent/tools`（`canUseDisk`），浏览器侧缓存在 `localStorage` 并派发 `TOOL_SETTINGS_EVENT`。存档设置（`GameSavesSettings`）不变：面板开关属于「游戏内显示什么」，与迷你地图、旅伴同类，不进存档设置的 revision 同步。
- **面板可见性**：`components/game-tools/tool-panels.ts` 定义 `ToolPanelId`（`miniMap` / `companion` / `autoSaves` / `quickSaves`）与对应的设置字段。关闭按钮造成的「本次隐藏」原先是各组件内的 state，现移到模块级集合，并派发 `chaya:tool-panel-dismiss` 事件。原因是作弊浮层与 Agent 浮层是同一窗口里的两个 React 根，快捷键在作弊浮层里处理，必须能读到并清除旅伴面板的隐藏状态。
  - `useToolPanelVisibility(id, enabled)`：返回 `visible` 与 `dismiss`；开关关闭时清除隐藏状态。
  - `isToolPanelVisible(id, settings)`：开关开启且本次未隐藏。
  - `toggleToolPanel(id, settings, update)`：开着但被本次隐藏时只取消隐藏；否则用函数补丁在轮到保存时按最新设置决定：可见写 `{ [field]: false }`，不可见清除隐藏并写 `{ [field]: true }`（连点每次都生效）。
- **公共组件**：调用方只传 `panel={ToolPanelId}`。位置、默认尺寸、存储键由 `tool-panels.ts` 的 `TOOL_PANEL_FRAME` 给出，尺寸范围统一为 `TOOL_PANEL_SIZE`（最小 220×160，最大 640×640）。面板内部的工具条、居中空态 / 提示、失败条用 `components/game-tools/MiniPanelParts.tsx`（`MiniPanelBar`、`MiniPanelNotice`、`MiniPanelAlert`、`miniPanelIconButton`）。新增迷你面板时先在两张表里登记，不要在组件里另写尺寸或外壳。
- **位置**：每个面板的 `side`（`left` / `right`）决定默认位置的横向锚点取左边距还是右边距。`mountedPanels` 记录所在侧，`shouldStack` 只比较同一侧的上下两个面板，窗口放不下时各占一半高度。迷你地图右上、旅伴右下、自动存档左上（`chaya.saves.auto.frame.v1`）、快速存档左下（`chaya.saves.quick.frame.v1`）。
- **存档面板**：`components/game-saves/GameSavesMiniPanels.tsx` 导出 `AutoSaveMiniPanel`、`QuickSaveMiniPanel`，只接收 `useGameSaves` 与 `useGameSaveActions` 的结果，不自己取数据。插件侧 `FloatingGameSaves` 放在 `GameEditOverlayProviders` 内（与 `FloatingMiniMap` 同级），复用浮层的 `GameToolTransportContext`、确认框与通知。任一面板可见时才挂载内部组件，只创建一份 `useGameSaves`，两个面板共用；两者都不可见时不取快照、不订阅状态。
  - 不显示缩略图，不提供删除和清空。
  - 操作经 `useGameSaveActions`，确认框、「仍然保存」、并发规则与页面一致。
- **页面开关**：`AutoSaveCard`、`QuickSaveCard` 设置区各加一行「游戏内迷你面板」开关，用 `useToolSettings(request)`。`GameSavesPage` 新增 `request` 参数：Web 用默认的浏览器请求，局内浮层由 `GameEditAgentSettingsPane` 传入插件请求。工具设置读取失败（非本机模式）时开关禁用并显示原因。
- **快捷键**：
  - `run-hotkeys.ts` 新增 4 个 `ui` 类目标，id 为 `ui:panel:<ToolPanelId>`，分组 `edit.groupMiniPanels`，紧跟「面板」分组；默认不绑定。
  - 插件 `App` 的全局 keydown 处理中，`ui` 类目标若是 `panel:` 前缀，调用 `toggleToolPanel`，其余 `ui` 目标（唤出键、控制台）仍由 `console/panel-hotkeys.ts` 处理。
  - 工具设置未读到（`loaded` 为假或有 `error`）时跳过，不 `preventDefault`。
  - 输入框聚焦时不响应，跳过 `ev.repeat`。

## 日志与文案

- 插件侧用 `createLogger('game-saves')`：保存、读档、删除、清空、轮换、设置变更写 `info`（含来源与耗时）；非安全时刻保存与对账写 `warn`；失败写 `fail`。
- 文案在 `saves.*`（`lib/i18n/messages/parts/saves{,.en,.ja,.ko}.ts`，类型 `saves-types.ts`），中、英、日、韩四种：
  - 组件内用 `useT()`；`format.ts`、`auto-status.ts` 等纯函数接收 `t` 参数（`Translate`）。
  - 组件外（插件控制器、序列化、存储抛出的报错，游戏内提示）用 `tNow()`（`lib/i18n/current.ts`），语言规则同 `LocaleProvider`：用户明确选择优先，否则跟随浏览器。
  - `validateGameSavesSettings` 返回文案 key 与参数，由调用方翻译；设置接口固定返回英文消息和错误码（`INVALID_SETTINGS`、`REVISION_CONFLICT`），页面按错误码显示当前语言。
  - 日志固定中文：等待原因用 `translate(MESSAGES.zh, saveWaitReasonKey(reason))`。

## 分阶段

| 阶段 | 内容                                                               | 状态   |
| ---- | ------------------------------------------------------------------ | ------ |
| 1    | 类型、校验、轮换；序列化、安全判定、存储与对账；控制器、协议与通道 | 已完成 |
| 2    | 页面两张卡片与导航；游戏内提示；自动调度、挂机与等待原因           | 已完成 |
| 3    | 数字键按物理键位识别；默认绑定；快速存档快捷键；读档后收尾         | 已完成 |
| 4    | 快捷键网页与游戏同步；本机未连接时的只读存档列表 API               | 未做   |
| 4a   | 页面、迷你面板、游戏内提示与报错多语言                             | 已完成 |
| 5    | 在 2–3 个 MV、MZ 样例游戏上按「待验证」清单手测，修正引擎适配      | 未做   |
| 6    | 存档迷你面板；四个迷你面板的快捷键；浮动面板左右两侧布局           | 已完成 |

第 4 阶段前，在 Web 控制台修改的快速存档快捷键不会同步到游戏（游戏使用默认值或局内浮层里改的绑定），对应需求验收第 26 条。

## 测试

- `__tests__/lib/game/game-saves-rules.spec.ts`：设置默认值与校验、非法条目 id、10 个固定槽、轮换（含保护条目、忽略快速存档）。
- `__tests__/plugins/cheat/game-saves-controller.spec.ts`：用内存存储和桩环境覆盖手动保存与轮换、不安全时的确认与强制、快捷键不安全提示、读档不写条目且读档后等满间隔并有操作才自动存档、读档失败回滚且不留备份、空槽与过期设置、调小上限立即删除、快捷键在未开启时不生效而页面按钮可用、定时存档（到期、等待原因、1 秒稳定、挂机）、失焦不计时（`counting` 为假）、启动对账（移除缺文件的条目，索引外的内容文件补成最小条目并还原保存时间）、新自动存档提交失败删除内容文件、入队后变得不安全时保留已累计时间、覆盖快速存档失败时保留旧档、本机位置离线时定时存档等待而不重试、读档期间的设置修改排队生效。
- `__tests__/plugins/cheat/game-saves-web-hooks.spec.tsx`：页面 hook 的连接与存读档、设置写本地并带更高版本下发、连接时下发更新的本地设置、游戏侧版本已变时以游戏侧最新设置为底重放改动（两端同版本同内容）。
- `__tests__/app/game-saves-store-api.spec.ts`：本机存档读写、越界 id 拒绝、坏 id 返回 400、缺内容返回 404 且不带路径、`index.json` 损坏时按空返回并留副本。
- `__tests__/lib/game/hotkeys-quick-save.spec.ts`：`⌥3`、`Shift+3` 按键位匹配，字母仅 Alt 时按键位，改按键位前保存的旧绑定仍能匹配，20 项快速存档目标，默认绑定及让位。
- `__tests__/app/game-saves-settings-api.spec.ts`：通用设置默认值、未连接保存、revision 跳跃与冲突、范围校验。
- `__tests__/app/game-saves-store-api.spec.ts`：本机存档按游戏分目录读写、拒绝越出目录的 id、拒绝缺少 `entries` 的索引。
- `__tests__/plugins/cheat/game-tool-transport.spec.tsx`：局内通道直接调用存档与键鼠运行时、转发状态与变更事件。
- `__tests__/components/game-tools/tool-panels.spec.tsx`：面板可见性、关闭按钮的本次隐藏、快捷键切换（可见时关闭、隐藏时清除并开启），工具设置新字段的默认值。
- 引擎相关行为只能在真实游戏里验证，按下方清单手测。

## 待验证

- `$gameSystem.onBeforeSave()` 在 MV 与 MZ 中写入的字段，以及改回 `_saveCount` 后游戏内存档次数显示是否正确。
- 不经过 `Scene_Load` 直接恢复并 `goto(Scene_Map)` 时，地图、事件、并行处理、天气、画面色调和 BGM 是否完整；冻结当前场景是否在所有场景下安全；MZ 的 `correctDataErrors` 是否必要。
- 战斗或事件进行中读档时，`BattleManager`、`Scene_Battle.terminate` 对新队伍对象的处理是否有副作用。
- `$gameMap.isEventRunning()` 能否覆盖常见插件自定义的过场；`_menuCalling`、`isSceneChanging` 在 MZ 中是否同名。
- 常见存档类插件给 `makeSaveContents` 追加的数据能否随本功能一起保存和恢复。
- `SceneManager.snap()` 在浮层暂停期间与 WebGL 渲染器下能否取到当前画面。
- 浏览器版游戏的 IndexedDB 配额是否够存 120 + 10 份。
