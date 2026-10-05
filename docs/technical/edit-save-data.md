# 修改：数据 技术方案

> 状态：已实现。需求见 [../edit-save-data.md](../edit-save-data.md)，下文「需求 §x」均指该文档。

## 1. 决策

- **游戏侧是唯一真源**：读、比较、写、校验、撤销、锁定、搜索全部在插件里做；网页端与局内浮层只是两个「客户端」，经同一个传输接口访问。安全规则在游戏侧强制，网页端只做体验校验。
- **不序列化整份进度**：所有读取按路径直达运行时对象，一次一层；实时更新只比较订阅的路径（需求 §2）。
- **身份优先于路径**：游戏侧给每个对象分配编号（`oid`），草稿、写入、锁定、撤销都带所属对象的 `oid`，路径相同但对象换了即判失效，杜绝写错对象。
- **写入走现有指令通道**：`edit.cmd` / `edit.ack`（编号、去重、重试），回执扩展为可携带结果；读取类走新的请求 / 响应消息（不需要重试语义）。
- **纯逻辑放 `lib/`**：路径校验、只读 / 确认规则、名称标注规则、输入解析在 `lib/game/save-data/`，插件与网页共用同一份，避免两边规则不一致。
- **网页端按行订阅渲染**：当前值存放在外部 store，行组件用 `useSyncExternalStore` 只订阅自己那一行；每秒的差异只重渲变化的行，输入框所在行不会因别的行变化而重渲。

## 2. 总体架构

```text
                    ┌──────────── 插件（游戏进程）────────────┐
 网页 /cheat/data ──link──▶ remote-bridge ─┐                  │
   useSaveData             (data.* 消息,   │   save-data/      │
   LinkTransport            edit.cmd 写入) ├─▶ read / watch /  │──▶ $gameXxx / ConfigManager
                                           │   write / struct /│
 局内浮层「数据」 ──直接调用──▶ DirectTransport┘   lock / undo /   │
   useSaveData                                 search          │
                    └──────────────────────────────────────────┘
```

- 每个客户端拥有自己的 **Watcher 实例**（订阅列表 + 比较游标），两端同时打开互不干扰。
- **撤销栈、锁定表、代数** 在插件里全局唯一，两端共享（需求 §4.9）。

## 3. 模块落点

```text
lib/game/save-data/                    # 纯函数，插件与网页共用，无 IO
  types.ts        DataPath / DataCell / DataRow / DataPage / DataWriteItem / DataOp / 结果类型
  path.ts         pathKey、校验（保留名、深度、段长）、URL 段编解码、复制用表达式（`$gameParty._items[12]`）
  rules.ts        只读 / 需确认规则（需求 §4.8）、预设锁定映射（gold / var / sw / hp / mp / item…）
  schema.ts       名称标注与期望类型：按路径 + NameSource 给出 label / labelKey / expectType / refresh
  value.ts        输入解析（按类型）、值格式化、相等判断
  hash.ts         FNV-1a 键签名
  limits.ts       常量（§9）
  index.ts

plugins/src/cheat/session/save-data/
  roots.ts        11 个根的解析；config 虚拟根；代数检测（根对象身份）
  identity.ts     WeakMap<object, oid>
  resolve.ts      路径 → { owner, key, value, ownerOid }；开关 / 变量虚拟下标；保留名与自有属性检查
  names.ts        NameSource 实现：$dataSystem / $dataActors / $dataItems… + tName 译名；地图事件名复用 live-events 索引
  read.ts         listLevel(path, offset, limit)、readFull(path)；每层键列表缓存
  watch.ts        createWatcher(onDiff)：订阅、首次回值、每秒比较（2 ms 预算 + 游标）
  write.ts        applyWrites(items)：整体校验 → 逐项写 → 补调刷新 → 读回
  struct.ts       数组插入 / 复制 / 删除、对象增删字段
  locks.ts        数据锁定表（path + oid + value），200 ms 写回；与预设锁定互斥
  undo.ts         撤销栈（50 步）、冲突检查、强制还原
  search.ts       分片 DFS 搜索、取消
  writers.ts      已知结构的专用写入（开关 / 变量 / 独立开关 / 物品数量 / 设置）
  pins.ts         钉住项（游戏侧 localStorage，按游戏键）
  status.ts       状态快照（代数、撤销摘要、锁定列表、钉住项）与变更通知
  index.ts        SaveDataService：供 remote-bridge 与局内浮层调用的统一入口
plugins/src/cheat/session/remote-bridge.ts   # 处理 data.* 请求与 data 类 edit.cmd；回执带结果
plugins/src/cheat/ui/save-data-transport.ts  # DirectTransport（局内浮层）

lib/runtime/game-link-protocol.ts      # data.* 消息、data 类 op、edit.ack.result
lib/runtime/game-edit-sync.ts          # data 类 op 的 fields（每条指令唯一，不参与快照匹配）
hooks/useGameEditLinkSync.ts           # runCmd 返回 ack.result

components/game-edit/save-data/
  transport.ts            SaveDataTransport 接口
  link-transport.ts       LinkTransport（网页，经 GameLinkContext）
  store.ts                行值 store、草稿 store（外部 store + 订阅）
  useSaveData.ts          当前层、分页、订阅、代数、状态、搜索的编排
  SaveDataPane.tsx        页面骨架：面包屑、工具栏、常用栏、列表 / 搜索结果
  DataList.tsx            虚拟列表 + 可见区上报
  DataRowView.tsx         一行：名称 / 当前值 / 修改为 / 操作（宽、窄两种布局）
  DraftInput.tsx          按类型的输入控件（数字 / 文本 / 布尔 / 空 / 类型选择）
  DataToolbar.tsx         待应用、全部应用、清空、撤销、锁定列表
  PinsBar.tsx             常用与钉住
  StructDialogs.tsx       添加项 / 添加字段 / 删除确认
components/sk/VirtualList.tsx          # 固定行高虚拟列表（通用）
components/game-edit/tabs.ts / tab-icons.tsx   # 新增 data 分类、editDataHref
app/cheat/[tab]/[[...pane]]/page.tsx   # data 的段解码与校验
lib/i18n/messages/data-types.ts + parts/data(.en/.ja/.ko).ts
```

单文件目标 ≤ 600 行。`GameEditWorkbench.tsx` 已 690 行，只加一个懒加载分支和 `saveData?: SaveDataTransport` 属性，不放任何数据页逻辑。

## 4. 数据模型（`lib/game/save-data/types.ts`）

```ts
type DataPath = string[] // 数组下标也用字符串
type DataKind = 'number' | 'string' | 'boolean' | 'null' | 'undefined' | 'object' | 'array' | 'unsupported' | 'cycle'
type ValueType = 'number' | 'string' | 'boolean' | 'null'

/** 一个字段在某一时刻的值；基本类型带 value，容器带摘要 */
type DataCell = {
  kind: DataKind
  value?: string | number | boolean | null // 字符串截断到 120 字
  truncated?: boolean // 字符串被截断，修改前需 readFull
  className?: string // 构造函数名，如 Game_Actor
  size?: number // 容器子项数（开关 / 变量为数据库总数）
  sig?: number // 容器键签名（子项 ≤ 1000 时）
  oid?: number // 容器自身的对象编号
}

type DataRow = DataCell & {
  key: string
  label?: string // 游戏数据里的名称（已翻译），如开关名、角色名
  labelKey?: string // 界面文案 key（config 设置项）
  expectType?: ValueType | 'number|string' // 已知结构的固定类型；'number|string' 时默认 number
  nullable?: boolean // 是否允许「设为空」（类型固定的已知结构为 false）
  readonly?: boolean
  confirm?: boolean // 修改需确认
  presetLock?: string // 已被预设锁定占用（如 'gold'），只提示不重复锁
  locked?: boolean // 数据锁定中
}

type DataPage = {
  path: DataPath
  gen: number
  oid: number // 当前层对象编号（草稿、写入的 ownerOid）
  kind: 'object' | 'array'
  className?: string
  total: number
  offset: number
  rows: DataRow[]
  canInsert: boolean // 是否允许增删子项（需求 §4.4）
  insertMode?: 'value' | 'item' // item：物品类按物品选择
}

/** 脱离分页单独返回的行（钉住项、搜索命中）：带完整路径与所属对象编号 */
type DataRowAt = DataRow & { path: DataPath; ownerOid: number; labels: (string | null)[] } // labels：每段的名称标注

type DataUndoSummary = { count: number; first: { path: DataPath; label?: string; before: DataCell; after: DataCell } | null; kind: 'write' | 'struct' }

type DataWriteItem = { path: DataPath; ownerOid: number; type: ValueType; value: string | number | boolean | null; confirmed?: boolean }
type DataWriteResult = { path: DataPath; ok: boolean; readback?: DataCell; error?: string; code?: 'stale' | 'readonly' | 'confirm' | 'type' | 'missing' }
```

`pathKey(path)` = `JSON.stringify(path)`，用作所有 Map 的键。

## 5. 协议（`lib/runtime/game-link-protocol.ts`）

### 5.1 读取类消息（请求 / 响应，带 `reqId`）

```ts
// Web → 游戏
{ type: 'data.list'; reqId; path; offset; limit }
{ type: 'data.read'; reqId; path }                              // 完整长字符串（≤ 64 KiB）
{ type: 'data.rows'; reqId; paths: DataPath[] }                 // 按路径取单行（≤ 300），用于钉住项
{ type: 'data.watch'; sid; entries: { path; oid?: number; ownerOid?: number }[] }  // 全量替换订阅；sid 递增；entries 为空即停止
{ type: 'data.search'; reqId; path; query; scope: 'all' | 'name' | 'value' }
{ type: 'data.search.cancel'; reqId }
{ type: 'data.status.request' }

// 游戏 → Web（data.page / data.search.hits 经 sendChunked 分片）
{ type: 'data.page'; reqId; ok: true; page: DataPage } | { type: 'data.page'; reqId; ok: false; error; code?: 'missing' | 'not-ready'; existingDepth?: number }
{ type: 'data.value'; reqId; ok; cell?: DataCell; error? }
{ type: 'data.rows.result'; reqId; rows: (DataRowAt | { path; missing: true })[] }
{ type: 'data.diff'; sid; gen; changes: { path; cell: DataCell }[]; replaced?: DataPath[] }
{ type: 'data.search.hits'; reqId; hits: DataRowAt[]; done; truncated; scanned }
{ type: 'data.status'; gen; ready: boolean; undo: DataUndoSummary | null; undoDepth: number; locks: { path; label?: string; value }[]; pins: { path; label?: string }[] }
```

- `data.watch` 收到后游戏**立即**回一条 `data.diff`，含全部新增条目的当前值（需求 §2.3「新进入可见区的行」），之后每秒只发变化。`sid` 用于丢弃旧订阅的迟到差异。
- `replaced`：订阅的容器 `oid` 或签名变了，或叶子条目的所属对象 `ownerOid` 变了。网页端若正处于该层则重取该层；`replaced` 只触发重取，不直接让草稿失效（草稿失效规则见 §7.2）。
- `data.status` 在客户端请求（页面挂载时发 `data.status.request`）、订阅时、代数变化、撤销栈 / 锁定 / 钉住项变化时推送；没有变化不发。
- `existingDepth`：路径中最深的仍存在的前缀长度，网页端据此退回上层。

### 5.2 写入类指令（`edit.cmd` 新增 op）

```ts
| { op: 'dataWrite'; items: DataWriteItem[] }                                  // ≤ 200 项
| { op: 'dataStruct'; path; ownerOid; action: 'insert' | 'copy' | 'remove' | 'addKey' | 'removeKey';
    index?: number; key?: string; from?: number; valueType?: ValueType; value?: string | number | boolean | null; confirmed?: boolean }
| { op: 'dataLock'; path; ownerOid; on: boolean; value?: string | number | boolean; valueType?: ValueType; confirmed?: boolean } // value 缺省 = 锁当前值；给出时先按 dataWrite 写入（进撤销栈）再锁
| { op: 'dataUnlockAll' }
| { op: 'dataPins'; pins: { path; label?: string }[] }                       // 全量替换，≤ 30
| { op: 'dataUndo'; force?: boolean }
```

- `edit.ack` 增加 `result?: unknown`，按 op：

  | op              | result                                                                                      |
  | --------------- | ------------------------------------------------------------------------------------------- |
  | `dataWrite`     | `DataWriteResult[]`                                                                         |
  | `dataStruct`    | `{ path: DataPath; index?: number }`（数组操作带变动下标，供草稿失效，见 §6.7）             |
  | `dataLock`      | 带 `value` 时为该次写入的 `DataWriteResult`；否则为锁定值的 `DataCell`；解除锁定时无 result |
  | `dataUndo`      | `{ applied: boolean; reason?: 'replaced'                                                    | 'struct-moved'; conflicts?: { path; label?; current: DataCell }[] }` |
  | `dataUnlockAll` | 无（结果体现在 `data.status`）                                                              |
  | `dataPins`      | 无（结果体现在 `data.status`）                                                              |

- 去重重试：`remote-bridge` 现有 `ackedCmdIds` 只记编号，重复指令会回一个**没有结果**的 ack。新增 `ackResults: Map<cmdId, result>`（上限 200，与 `ackedCmdIds` 同步淘汰），重复指令原样回放结果。
- `fieldsForEditCmd`：data 类 op 返回 `[`data:${cmdId}`]`，`expectForEditCmd` 返回 `undefined`，只靠 ack 清除 pending，不参与 `edit.state` 快照匹配。
- `useGameEditLinkSync.runCmd` 改为 `Promise<unknown>`，resolve 为 `ack.result`；现有调用方忽略返回值，不受影响。
- `dataWrite` 是「整体校验后逐项写」：任一项校验不过时整批不写，ack `ok: true` + 每项 `code`，由网页端标出问题行（这不是传输失败，不走 `ok: false`）。

## 6. 游戏侧实现（`plugins/src/cheat/session/save-data/`）

### 6.1 根与代数（`roots.ts`）

- 根表：`system → $gameSystem`、`screen → $gameScreen`、`timer → $gameTimer`、`switches → $gameSwitches`、`variables → $gameVariables`、`selfSwitches → $gameSelfSwitches`、`actors → $gameActors`、`party → $gameParty`、`map → $gameMap`、`player → $gamePlayer`、`config → CONFIG_ROOT`。
- `ready` = 当前场景不是 `Scene_Boot` / `Scene_Title`，且 `$gameParty` 与 `$gameMap` 存在、`$gameMap.mapId() > 0`；否则所有读取回 `code: 'not-ready'`，写入类指令以同样原因拒绝。
- 从 `ready` 变为不 `ready`（回到标题）时同样 `gen++`，清空撤销栈与数据锁定（需求 §4.2）。
- 代数：保存上一次 10 个根对象的引用，每次 watch 比较时先比较根引用（10 次 `===`），任一变化则 `gen++`、清空撤销栈与数据锁定、推送 `data.status` 与带 `replaced: [[]]` 的 `data.diff`。没有 watcher 时由读取请求顺带检查。
- `config` 虚拟根：键来自 `ConfigManager.makeData()`；读 `ConfigManager[key]`，写 `ConfigManager[key] = v`（经引擎 setter，例如音量会同步到 `AudioManager`）后 `ConfigManager.save()`。只有这一层，没有下层。

### 6.2 对象编号与路径解析（`identity.ts`、`resolve.ts`）

- `oidOf(obj)`：`WeakMap<object, number>`，首次见到时分配自增编号；不阻止回收。
- `resolve(path)` 逐段下钻，返回 `{ owner, key, value, ownerOid, exists }`：
  - 每段校验：非保留名（`__proto__` / `constructor` / `prototype`）、段长 ≤ 256、深度 ≤ 32。
  - 只走自有属性：`Object.prototype.hasOwnProperty.call(owner, key)`；属性描述符为访问器（getter / setter）时拒绝（`config` 根除外）。
  - 开关 / 变量虚拟下标：`switches._data` / `variables._data` 的下标 `1..System 总数` 即使不是自有属性也视为存在（值 `undefined`）。
  - 中途遇到基本类型或不存在 → `exists: false`，并记录 `existingDepth`。

### 6.3 读取一层（`read.ts`）

- 当前层是数组：下标 `offset..offset+limit`；开关 / 变量按数据库总数补齐（`$dataSystem.switches.length - 1`），下标 0 不显示。
- 当前层是对象：键列表 `Object.keys(obj)` 过滤掉函数与访问器；**按 `oid` 缓存键列表 5 秒**，避免大对象翻页时每页重算 `Object.keys`；签名变化时作废。
- 每个子项生成 `DataRow`：`cellOf(value)` + `schema.ts` 标注 + `rules.ts` 只读 / 确认 + 锁定状态。
- `cellOf`：字符串截断 120 字并标 `truncated`；容器给 `className`（`value.constructor?.name`，普通对象为空）、`size`、`oid`、`sig`；与祖先链上任一对象相同 → `kind: 'cycle'`；`Map` / `Set` / 类型化数组 / `Date` 等 → `unsupported`。
- `readFull(path)`：只对字符串有效，> 64 KiB 时拒绝。

### 6.4 名称标注（`schema.ts` + `names.ts`）

`schema.ts` 是纯函数：`annotate(path, key, NameSource) → { label?, labelKey?, expectType?, refresh? }`。规则按路径模式匹配：

| 路径模式                                       | 标注                          | expectType     | refresh     |
| ---------------------------------------------- | ----------------------------- | -------------- | ----------- |
| `switches._data[i]`                            | 开关 i 的名称                 | boolean        | map         |
| `variables._data[i]`                           | 变量 i 的名称                 | number\|string | map         |
| `selfSwitches._data["m,e,L"]`                  | 地图名 · 事件名 · L           | boolean        | map         |
| `actors._data[i]`                              | 角色 i 的名称                 | —              | —           |
| `actors._data[i].*`                            | —                             | —              | actor       |
| `party._items` / `_weapons` / `_armors` `[id]` | 物品 / 武器 / 防具名          | number         | map         |
| `party._actors[n]`                             | 该角色 id 对应角色名          | number         | actor-party |
| `map._events[i]`                               | 事件名（当前地图 `$dataMap`） | —              | —           |
| `screen._pictures[i]`                          | 「图片 i」                    | —              | —           |
| `config.<key>`                                 | `labelKey: data.config.<key>` | 按当前值       | config      |

- `NameSource`（`names.ts`）：`$dataSystem.switches/variables`、`$dataActors`、`$dataItems/Weapons/Armors`、`$dataMapInfos`、`$dataMap.events`，统一经 `tName` 译名；其他地图的事件名复用 `live-events` 的事件索引缓存（已构建时），未构建时显示「事件 #id」，不为标注去读地图文件。
- refresh 含义见 §6.6。开关、变量、独立开关、物品数量、设置的 `nullable` 为 false。
- 预设锁定映射还包括 `actors._data[i]._level` → `level:i`。

### 6.5 订阅与比较（`watch.ts`）

```ts
createWatcher(onDiff: (msg) => void): { set(sid, entries), dispose() }
```

- `set`：替换订阅（≤ 300 条，超出截断），立即对**新增**条目取值并 `onDiff`；之前已在的条目保留上次的指纹，不重复推送。
- 指纹：基本类型为值本身；容器为 `oid|size|sig`。订阅时带了 `oid`（容器）或 `ownerOid`（叶子）而当前不一致 → 计入 `replaced`。
- 定时器 1000 ms；每轮从游标处开始，`performance.now()` 超过 2 ms 即停，记下游标，下一轮继续（条目少时一轮全部比完）。
- 键签名 `sig`：子项 ≤ 1000 时为 FNV-1a(键名 + 每个子项的 `oid` 或 kind)，否则不计算（只比 `size`）。
- 没有订阅条目时定时器停止；收到空 `entries`、客户端断开、局内浮层关闭时 `dispose`。

### 6.6 写入（`write.ts`）

1. **整体校验**（任一不过 → 整批不写，逐项返回 `code`）：路径可解析、`ownerOid` 等于当前所属对象编号（否则 `stale`）、非只读、需确认的带 `confirmed`、类型合法（有值字段保持原类型；空值按 `expectType` 或客户端指定的 `type`；容器字段不可写）、数字为有限值。
2. **逐项写**（每项写前记录 `before = { exists, value }` 进本次撤销步）。命中 `writers.ts` 的已知结构走专用写入，其余 `owner[key] = value`：

   | 路径                                           | 写入方式                                                                  |
   | ---------------------------------------------- | ------------------------------------------------------------------------- |
   | `switches._data[i]`                            | `$gameSwitches.setValue(i, v)`（内含地图刷新）                            |
   | `variables._data[i]`                           | `$gameVariables.setValue(i, v)`（数字取整，内含地图刷新）                 |
   | `selfSwitches._data[key]`                      | `$gameSelfSwitches.setValue(key.split(','), v)`（false 时引擎删除该键）   |
   | `party._items` / `_weapons` / `_armors` `[id]` | `$gameParty.gainItem(item, v - 当前数量)`（受 `maxItems` 截断，0 时删键） |
   | `config.<key>`                                 | `ConfigManager[key] = v`，批末 `ConfigManager.save()`                     |

3. **补调刷新**（直接写入的项，同一批去重，写完统一调用）：
   - `map`：`$gameMap.requestRefresh()`。
   - `actor`：找到路径上最近的 `Game_Actor` 祖先，调 `actor.refresh()`。
   - `actor-party`：`$gamePlayer.refresh()` 与 `$gameMap.requestRefresh()`（队伍首位决定行走图）。
   - `config`：`ConfigManager.save()`。
4. **读回**：每项重新 `resolve` 取 `cellOf`，放进 `DataWriteResult.readback`；物品数量被删键时读回 `{ kind: 'number', value: 0 }`，该层随后的 `replaced` 让行消失。网页端比较读回值与提交值决定提示（需求 §4.3）。
5. **锁定联动**：写入的路径若处于数据锁定中，锁定值同步更新为读回值。
6. 推入撤销栈（只含成功项），推送 `data.status`。

### 6.7 结构修改（`struct.ts`）

| action      | 适用 | 行为                                                                                                           | 撤销记录          |
| ----------- | ---- | -------------------------------------------------------------------------------------------------------------- | ----------------- |
| `insert`    | 数组 | `splice(index, 0, value)`，value 为基本类型                                                                    | 插入位置          |
| `copy`      | 数组 | `JsonEx.makeDeepCopy(arr[from])` 后插入，保留类（MV / MZ 均有 `JsonEx.makeDeepCopy`）                          | 插入位置          |
| `remove`    | 数组 | `splice(index, 1)`，保存被删的元素引用                                                                         | 位置 + 原元素引用 |
| `addKey`    | 对象 | 键名非保留名、不以 `@` 开头、不在原型链上（不遮蔽方法 / 访问器）、≤ 256 字符；值为基本类型                     | 键名              |
| `removeKey` | 对象 | `delete obj[key]`，保存原值引用；只读字段、值为对象 / 数组的字段不可删 ；只读字段、值为对象 / 数组的字段不可删 | 键名 + 原值引用   |

- 开关 / 变量根层、只读对象、`config` 不允许结构修改；物品类 `insert` 改为「选择物品 + 数量」（等价于写 `party._items[id]`），`remove` 等价于数量清零（`gainItem` 负数），保持 `Game_Party` 内部一致。
- `selfSwitches._data` 的 `addKey`：键名必须为 `地图id,事件id,A–D`（id 为正整数），值为布尔，经 `setValue` 写入。
- `remove` / `copy` / `removeKey` 必须 `confirmed`。完成后补调刷新同 §6.6，推送该层 `replaced`；`ack.result` 带 `{ path, index }`，网页端据此让该数组下标 ≥ index 的路径上的草稿失效。数组插入 / 删除（含撤销）同时移除该数组下标 ≥ index 路径上的数据锁。

### 6.8 锁定（`locks.ts`）

- 表项：`{ path, ownerOid, type, value }`，键为 `pathKey`。独立 200 ms 定时器（表空时停止）：逐项 `resolve`，`ownerOid` 不符或路径不存在 → 移除并推送状态；值不同 → 写回并按 §6.6 补调刷新（同一轮去重）。
- 预设锁定互斥：`rules.ts` 的 `presetLockFor(path)` 把 `party._gold` → `gold`、`variables._data[i]` → `var:i`、`switches._data[i]` → `sw:i`、`actors._data[i]._hp/_mp` → `hp:i / mp:i`、`party._items[id]` 等 → `item:id`。`Cheats.isLocked(kind, id)` 为真时拒绝数据锁定，行上显示 `presetLock`。
- 只锁基本类型（不含 `null`）；对象 / 数组拒绝。
- 代数变化时清空全部数据锁定。锁定写回不进撤销栈。

### 6.9 撤销（`undo.ts`）

- 栈元素：`{ summary, steps: Step[] }`，最多 50；`Step` 为 `set`（path、ownerOid、before、after）或结构操作的逆操作数据。
- `dataUndo`：
  1. 检查每个 step：所属对象 `oid` 仍一致（否则整步作废，从栈移除，回 `applied: false, reason: 'replaced'`）。
  2. `set` 的当前值不等于 `after` → 冲突。存在冲突且未 `force` → 回 `applied: false, conflicts`，不改任何值。
  3. 结构步骤校验：插入 / 复制的撤销要求该下标处仍是当时插入的元素（对象比较引用、基本类型比较值）；删除的撤销要求数组长度 ≥ 原下标；增删字段的撤销要求键的存在状态与操作后一致。不满足 → 整步作废并移除，回 `applied: false, reason: 'struct-moved'`，`force` 也不执行。
  4. 逆序还原（`before.exists === false` 时删除该键，开关 / 变量虚拟下标还原为 `undefined`），补调刷新，出栈，推送状态。
- 摘要以结构化的 `DataUndoSummary` 下发（首项路径、名称、新旧值、项数），由网页端按当前语言格式化，如「金钱 1200 → 99999 等 3 项」。

### 6.10 搜索（`search.ts`）

- 迭代 DFS（显式栈 + `WeakSet` 防环），从 `path` 对应的对象开始，不跳过任何字段（只读字段也能搜到，只是不能改）。
- 匹配（需求 §4.7）：`name` 比较键名与标注（包含、不区分大小写）；`value` 对字符串按包含匹配，关键词能解析为有限数字时对数字按相等匹配，`true` / `false` 匹配布尔；`all` 两者任一命中。
- 命中以 `DataRowAt` 返回（含 `ownerOid` 与每段标注），网页端可直接在结果里写入。
- 分片：每片 8 ms，`setTimeout(0)` 让出；每片结束把新命中经 `data.search.hits` 推出（`done: false`）。上限 5 万个字段或 200 条命中即结束并标 `truncated`。
- 同一客户端新搜索自动取消上一个；`data.search.cancel` 或客户端断开时取消。

## 7. 网页侧实现

### 7.1 传输接口（`transport.ts`）

```ts
interface SaveDataTransport {
  list(path: DataPath, offset: number, limit: number): Promise<DataPage> // 失败抛 DataError（含 code / existingDepth）
  read(path: DataPath): Promise<DataCell>
  rows(paths: DataPath[]): Promise<(DataRowAt | { path: DataPath; missing: true })[]>
  watch(sid: number, entries: { path: DataPath; oid?: number; ownerOid?: number }[]): void
  onDiff(cb: (diff: DataDiff) => void): () => void
  onStatus(cb: (status: DataStatus) => void): () => void
  search(path: DataPath, query: string, scope: SearchScope, onHits: (batch: SearchBatch) => void): () => void // 返回取消函数
  run(op: DataOp): Promise<unknown> // 写入类，resolve 为 ack.result
}
```

- `LinkTransport`：`list` / `read` 用 `reqId` 关联 `data.page` / `data.value`，超时 15 秒；`run` 调 `runCmd`。断线时 transport 置空并拒绝未完成请求。
- `DirectTransport`（局内浮层）：直接调 `SaveDataService`，`watch` 创建本地 Watcher，`run` 同步执行后 resolve 结果；关闭页面时释放 watcher 并取消仍在分片执行的搜索。

### 7.2 状态（`store.ts`、`useSaveData.ts`）

- **值 store**：`Map<pathKey, DataCell>` + 按键订阅；`data.diff` 只更新对应键并通知该键的订阅者。`DataRowView` 用 `useSyncExternalStore(subscribe(key), get(key))`，只有变化的行重渲；变化时行上加一个 600 ms 的高亮 class。
- **草稿 store**：`Map<pathKey, Draft>`，`Draft = { path, label, type, raw, ownerOid, state: 'pending' | 'stale' | 'error', error? }`，同样按键订阅；输入框受控于草稿，不读值 store，因此值刷新不影响输入（需求 §4.3）。
  - 失效判定：
    1. 重取到草稿所在层时 `page.oid` 与草稿 `ownerOid` 不同（单独行经 `rows` / 搜索取到时比较 `DataRowAt.ownerOid`）。
    2. 本页结构修改成功后，同一数组下标 ≥ 变动下标的路径上的草稿（含其下层）。
    3. 代数变化：全部草稿。
    4. 写入回 `code: 'stale'`。
    5. 网页连接断开或切换到另一个游戏房间：全部草稿；同时清空当前值与已写入标记，避免对象编号碰巧相同时写入另一局游戏。
  - 不在屏幕上的草稿不主动校验，提交时由游戏侧按 `ownerOid` 兜底。
- **已写入标记**：本页会话内写入成功的 `pathKey` 集合，用于行首标记（需求 §4.1）。
  - 草稿随页面会话保存在模块级 store（同一标签页内切换分类不丢），刷新页面清空。
- **当前层**：`path`（来自 URL）、`pages`（按 200 分页懒取）、`page.oid`；`list` 失败且 `code: 'missing'` 时 `router.replace` 到 `path.slice(0, existingDepth)` 并提示一次。
- **订阅**：`DataList` 上报可见区间（含 8 行余量），与常用栏条目、可见搜索结果合并为 entries（≤ 300），200 ms 防抖后 `watch(++sid, entries)`；页面隐藏（`document.visibilityState`、切走分类、浮层关闭）时 `watch(sid, [])`。
- **代数变化**：清空值 store 与分页缓存，草稿全部 `stale`，重取当前层。

### 7.3 列表与行

- `components/sk/VirtualList.tsx`：固定行高（宽屏 36 px、浮层两行布局 52 px），`overscan` 8，基于滚动容器 `scrollTop` 计算区间；`onRangeChange` 回调供订阅使用；到底时触发 `onEndReached` 取下一页。
- `DataRowView`：宽屏四列（名称 / 当前值 / 修改为 / 操作），`@container` 窄于 40rem 时切两行布局；名称列显示 `label`（或 `t(labelKey)`），原始键淡色；容器行整行可点击进入。
- `DraftInput`：数字用现有 `NumberInput`（`allowDecimal`，允许负数，提交时经 `value.ts` 校验有限值），布尔用 `SwitchToggle`，字符串单行输入，`truncated` 时先 `read` 取全文再进入多行编辑；空值字段左侧显示类型选择（已知结构锁定为 `expectType`，`number|string` 默认数字）；`nullable` 为 false 时类型选择里没有「空」。回车 = 应用本行，Esc = 删除本行草稿。
- 「全部应用」：收集全部 `pending` 草稿 → 本地校验 → 需确认项合并到一个 `confirm()` → `run({ op: 'dataWrite', items })` → 按结果逐行处理：成功或读回不同（提示）则删除草稿，失败则 `state: 'error'`。

### 7.4 路由

- `tabs.ts` 在 `map` 后新增 `data`（`labelKey: 'data.tab'`），`editDataHref(path)` 使用仅包含 `[A-Za-z0-9_.-~]` 的可逆 UTF-8 十六进制编码生成路径，避免路由层重复解码 `%2F` 等字符。
- `page.tsx`：`data` 分类下段数 ≤ 32、每段解码后 ≤ 256 字符，否则重定向到 `/cheat/data`；不校验路径是否存在（由游戏侧回答）。
- 局内浮层没有 URL，当前路径保存在 `window.__chayaDataView`（同 `__chayaEventsView`）。

### 7.5 常用与钉住（`pins.ts`）

- 预置常用（路径常量）：`party._gold`、`party._steps`、`timer._frames`、`player._x` / `_y`、`player._encounterCount`、`system._saveCount`。
- 钉住项保存在游戏侧 `plugins/src/cheat/session/save-data/pins.ts`：`localStorage['chaya:data-pins:' + 游戏键]`，游戏键沿用 `map-history` 的规则（标题 + 游戏根目录）。经 `data.status.pins` 下发、`dataPins` 全量更新，网页与局内浮层共用一份；上限 30。
- 常用栏（预置 + 钉住）的行用一次 `rows(paths)` 取得（含 `ownerOid`）并加入订阅；`missing` 时显示「不可用」。

### 7.6 Agent 与 WebMCP

- `data` 分类不加入 `chaya_edit_*` 的任何能力；`initializer/webmcp/register-page-tools.ts` 的页面工具不暴露数据页操作；`page_get_context` 只报告当前分类为 `data`，不含数据内容。

## 8. 局内浮层

- `plugins/src/cheat/ui/App.tsx`：`data` 分类不需要 catalog（`tabNeedsCatalog` 返回 false），`scopeForTab('data')` = `'run'`（不额外读会话）。
- 浮层打开且处于 `data` 分类时创建 `DirectTransport`，关闭或切走即 `watch(sid, [])` 并释放 Watcher。
- 与网页端共用 `components/game-edit/save-data/` 全部组件；样式来源已包含 `components/game-edit/**`。

## 9. 上限与性能预算（`lib/game/save-data/limits.ts`）

| 常量                | 值     | 说明                    |
| ------------------- | ------ | ----------------------- |
| `PAGE_SIZE`         | 200    | 每次 `data.list` 的项数 |
| `PREVIEW_CHARS`     | 120    | 字符串预览              |
| `FULL_STRING_MAX`   | 64 KiB | `data.read` 上限        |
| `WATCH_MAX`         | 300    | 每个客户端订阅条目      |
| `WATCH_INTERVAL_MS` | 1000   | 比较周期                |
| `WATCH_BUDGET_MS`   | 2      | 每轮比较耗时上限        |
| `WATCH_DEBOUNCE_MS` | 200    | 网页端订阅更新防抖      |
| `SIG_MAX_KEYS`      | 1000   | 超过则不计算键签名      |
| `KEYS_CACHE_MS`     | 5000   | 对象键列表缓存          |
| `LOCK_INTERVAL_MS`  | 200    | 锁定写回周期            |
| `UNDO_MAX`          | 50     | 撤销步数                |
| `WRITE_BATCH_MAX`   | 200    | 一次 `dataWrite` 项数   |
| `SEARCH_NODE_MAX`   | 50 000 | 单次搜索遍历字段数      |
| `SEARCH_HIT_MAX`    | 200    | 单次搜索命中数          |
| `SEARCH_SLICE_MS`   | 8      | 搜索每片耗时            |
| `PATH_DEPTH_MAX`    | 32     | 路径深度                |
| `KEY_CHARS_MAX`     | 256    | 单段长度                |
| `PINS_MAX`          | 30     | 钉住项                  |

稳态成本：停留在某层不操作时，游戏侧每秒一次 ≤ 300 次路径解析与比较（预算 2 ms），无变化不发消息；网页端只重渲变化的行。翻页一次为一层 200 项的构建与分片发送。

## 10. i18n

`lib/i18n/messages/data-types.ts` 定义 `DataMessages`，`parts/data.ts`（zh）/ `data.en.ts` / `data.ja.ts` / `data.ko.ts` 四语言，`types.ts` 增加 `data: DataMessages`，各语言入口展开。内容：分类名、列名、按钮、空态、确认文案、错误码文案（`stale` / `readonly` / `confirm` / `type` / `missing` / `not-ready`）、`config.<key>` 设置项名称。游戏侧抛出的错误沿用现有做法用中文原文，经 ack `error` 透传。

## 11. 测试

- `__tests__/lib/game/save-data/`：`path`（保留名、深度、URL 编解码往返）、`rules`（只读 / 确认 / 预设锁定映射）、`schema`（各路径模式的标注与期望类型）、`value`（各类型解析、`NaN` / `Infinity` 拒绝）、`hash`。
- `__tests__/plugins/save-data/`（jsdom + 伪造的 `$gameXxx` / `$dataXxx` / `ConfigManager` / `JsonEx`）：
  - `read`：分页、开关补齐、访问器过滤、循环引用、`unsupported`。
  - `watch`：首次回值、只推变化、`oid` 替换进 `replaced`、预算中断后续比。
  - `write`：整体校验失败整批不写、`stale`、确认标记、补调刷新调用、读回与截断。
  - `struct` / `undo`：增删与撤销往返、冲突与强制、对象替换后作废、代数变化清栈。
  - `locks`：写回、与预设锁定互斥、对象替换自动解除。
  - `search`：分片、上限、取消。
  - 安全：`__proto__` / `constructor` 路径、原型属性、getter 一律拒绝。
- `__tests__/runtime/`：`remote-bridge` 对重复 `cmdId` 回放 `ack.result`；`runCmd` resolve 结果。
- 组件：`SaveDataPane` 的空态、值刷新不影响输入框、草稿失效标记、全部应用的校验拦截与逐行结果、撤销冲突确认。
- 手测：真实 MV / MZ 大型游戏按需求 §8 验收清单逐条执行；demo 游戏用于空态与基本读写。

## 12. 风险

- **直接写字段绕过游戏逻辑**：已对已知对象补调刷新；未知插件字段只能写入即生效，由确认与撤销兜底。
- **`JsonEx.makeDeepCopy` 复制的对象含内部引用**（如事件对象引用 `$gameMap`）：复制仅对同类数组提供，且需确认；撤销可移除复制项。
- **Watcher 与网页订阅不同步**：以 `sid` 丢弃旧差异；网页重连后重新 `watch` 全量回值。
- **大对象键列表**：`Object.keys` 结果按 `oid` 缓存 5 秒；超过 1000 键不算签名，只比数量，内容替换需手动刷新发现（列表本身每次翻页都是最新的）。
- **搜索与游戏帧争用**：8 ms 分片仍可能在低端机上偶发掉帧；搜索仅在用户触发时运行，可随时取消。
