# 增强寻路技术设计

> 状态：已实现。用户行为见 [需求文档](../smart-path.md)。

## 结构

| 职责                                | 代码位置                                                                                                                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 寻路算法（纯函数，不依赖引擎）      | `plugins/src/cheat/runtime/pathfinding.ts`                                                                                                                                          |
| 引擎适配：地图网格、接管玩家寻路    | `plugins/src/cheat/runtime/smart-path.ts`                                                                                                                                           |
| 开关（工具设置 `smartPathEnabled`） | `lib/game-agent/tool-settings.ts`                                                                                                                                                   |
| 「辅助 › 能力增强」页面             | `components/settings/EnhanceSettingsView.tsx`、`app/assist/enhance/page.tsx`、`components/input-assistance/assist-sections.ts`、`components/settings/GameEditAgentSettingsPane.tsx` |
| 钩子安装、读取开关                  | `plugins/src/cheat/runtime/cheats-run.ts`（`ensureSmartPathHook`）                                                                                                                  |
| 文案                                | `lib/i18n/messages/parts/edit*.ts`（四种语言）                                                                                                                                      |

## 引擎现状

MV / MZ 中玩家不在移动、没有方向键输入且 `$gameTemp` 有目的地时，`Game_Player.moveByInput` 每次停下都调用 `findDirectionTo(destX, destY)` 取下一步方向，返回 0 时 `updateNonmoving` 清除目的地。原版 `Game_Character.findDirectionTo` 的问题：

- `searchLimit()` 为 12：只展开 g < 12 的节点，目标远时取启发值最小的节点，即「直线最近」。
- 只用 `canPass` 判断，不看事件触发；接触触发的事件若优先级为「角色下 / 上」可通行，路线会踩上去。
- 开放列表是数组线性扫描，`closedList.contains` 也是线性，无法直接放大搜索范围。

点击 NPC 时目的地在 NPC 格，原版走到相邻格后返回朝向目标的方向，`moveStraight` 失败只转向，随后 `triggerTouchAction` 判定目的地在正前方并启动事件。增强寻路保留这个收尾。

## 算法

标准 A\*（四方向、单位步长、可达时保证最短）。不用 PathFinding.js、EasyStar 等库：它们只表达「某格能否通行」，而 RPG Maker 的通行按边判断（`isPassable(x, y, d)` 与反方向组合，单向栅栏、柜台、星号图块等同一格不同方向结果不同），且需要接入其他插件改写过的判定。算法部分不足百行，自行实现并单测。

```ts
type PathGrid = {
  width: number
  height: number
  loopX: boolean
  loopY: boolean
  /** 从 (x, y) 朝 d（2/4/6/8）走一步是否可行 */
  canStep(x: number, y: number, d: Direction): boolean
  /** 会触发的格：除目标外不进入 */
  avoid(x: number, y: number): boolean
}
type PathResult = { steps: Direction[]; end: { x: number; y: number }; reached: boolean }
type PathLimits = { maxExpand?: number; budgetMs?: number; now?: () => number }
function findPath(grid: PathGrid, start: Point, goal: Point, limits?: PathLimits): PathResult | null
```

- 存储：`Int32Array g / parent`、`Uint8Array closed`，按 `y * width + x` 索引；开放列表为自写的二叉堆（`Int32Array` 节点 + `Float64Array` 键），键为 `f`，同 `f` 时 `h` 小者优先，路线更贴近目标、少走回头路。
- 启发：曼哈顿距离，循环地图按环绕取短边，与 `$gameMap.distance` 一致；可采纳，结果最短。
- 走不到：记录已展开节点中 `h` 最小（同 `h` 取 `g` 小）的节点为 `end`，返回到它的路线，`reached = false`。可达区域全部展开，或展开数达到 `maxExpand`（引擎侧 32768，约 180×180）、耗时超过 `budgetMs`（引擎侧 6 ms，每展开 256 个节点检查一次，防止插件把 `canPass` 改得很慢时一步卡住整帧）时判定走不到；每格最多查 4 条边，开销主要在引擎的 `isPassable`。
- 目标格本身被 `avoid` 标记时允许进入；`avoid` 只拦截中途的格。
- 返回 `null`：`width * height > 1 << 20`（非标准地图）、起点越界、坐标不是整数（像素移动类插件），调用方退回原版。

## 引擎适配

`smart-path.ts` 导出 `installSmartPath(enabled: () => boolean, log?)`，只包装一次：`globalThis.__chayaSmartPath_v1__` 保存 `{ enabled, log }`，再次调用（插件热替换）只替换这两个字段，钩子读取的是最新开关，不叠加包装。

- 在 `Game_Player.prototype` 上定义自己的 `findDirectionTo`，原函数（可能来自 `Game_Character` 或其他插件）保存为 `fallback`。
- 以下情况直接调用 `fallback`：`enabled()` 为 false；原函数源码不含 `searchLimit`（说明已被寻路 / 像素移动插件替换，按函数缓存判断结果，首次写一条 `warn` 日志）；`isThrough()` / `isDebugThrough()`；`isInVehicle()`；玩家坐标不是整数；地图尺寸超限。
- 网格：
  - `canStep`：逐边调用 `this.canPass(x, y, d)`，其他插件对 `canPass` / `isMapPassable`（含 alias 到 `Game_CharacterBase` 上的）都生效。引擎的 `isCollidedWithCharacters` 每次遍历全部事件，规划期间在玩家实例上临时替换为「`occupied` 中有该格才调用原判定」，`occupied` 是规划开始时事件与载具坐标的集合；`finally` 中还原。
  - `avoid`：未抹除、有当前页、页内容非空（`list().length > 1`）、`isTriggerIn([1, 2])` 且 `!isNormalPriority()` 的事件坐标。普通优先级的接触事件本身会挡路，由 `canStep` 处理。
- 路线缓存：`{ mapId, goalX, goalY, steps, cursor, reached, atX, atY }`。每次调用：
  1. 路线能到达目标（`reached`），地图、目标与缓存一致，玩家在预期位置，`this.canPass(x, y, nextDir)` 为真，且下一格（非目标）此刻没有会触发的事件：返回下一步，游标前进。
  2. 否则重新规划（换目标、被 NPC 挡住、被事件推开、接触事件走到路线上都走这里）。走不到目标时路线只通往最近可达格，每步都重新规划，NPC 让开通道后即可继续前往（与原版每步重算一致）。
  3. 新路线的第一步按真实 `canPass` 就走不通时（规划用的占位判断只看事件所在格，插件把事件碰撞扩成多格时会不一致）丢弃路线并调用 `fallback`，避免返回 0 让点击失效。
- 结果处理：有下一步则返回；路线走完时丢弃缓存（再次点击同一格会重新规划），目标在正前方，或隔着柜台（`$gameMap.isCounter`）在前方第二格时返回朝向目标的方向（保留点击 NPC、隔柜台点店员的对话收尾）；目标走不到时，按目标所在的主方向（|dx| ≥ |dy| 取水平）转身：只在那一边走不通时返回该方向（引擎 `moveStraight` 失败只转身），走得通说明那格是要绕开的触发格，返回 0；其余返回 0，引擎随后清除目的地。
- `findPath` 返回 `null` 时调用 `fallback`。

`Game_Player.moveByInput`、`triggerTouchAction`、目的地标记等都不改。旅伴 / Agent 的 `player.moveTo` 写的是同一个 `$gameTemp` 目的地，逐格模式直接调用 `findDirectionTo`，因此自动生效。

## 开关

- 存在工具设置（`ToolSettings.smartPathEnabled`，默认 `true`；旧设置缺字段时按 `true`），与迷你地图、旅伴同一份，本机服务写盘、局内浮层经 `/api/integration/game-agent/tools` 读写。
- 页面：`ASSIST_SECTIONS` 加 `enhance`（`nav.enhance`，图标 `LuSparkles`），Web 路由 `app/assist/enhance`，局内浮层 `GameEditAgentSettingsPane` 渲染同一个 `EnhanceSettingsView`；开关用 `useToolSettings().update({ smartPathEnabled })`。
- 插件：`ChayaEdit` 入口启动时调用 `RunCheats.ensureSmartPathHook()` → `installSmartPath(smartPathEnabled)`，不等会话盘状态（`applyGameEditDisk` 只在盘上有状态时才调 `ensureHooks`，新游戏会漏装）；`ensureHooks()` 中的再次调用由全局标记去重。`smartPathEnabled` 首次调用时读 `readCachedToolSettings()`，之后监听 `TOOL_SETTINGS_EVENT` 与 `storage` 事件（key 为 `TOOL_SETTINGS_STORAGE_KEY`，在线版同源 Web 页改开关时同步）更新内存值，寻路每步不读 localStorage。局内工具浮层的 `useToolSettings` 每 3 秒拉取工具设置（带保存中保护）并派发该事件，Web 端改动几秒内生效。
- 不看 `clickMove`：点击移动关闭时 `setDestination` 已是空操作，玩家点击不会产生目的地，而 AI 直接写目的地仍应按增强寻路走。

## walk demo

`fixtures/game-walk` 原先用自己的 BFS（`stepToward`）点击寻路，接管不到。改为 RM 的接口：

- `Game_Player.findDirectionTo` 按原版算法实现（搜索上限 12、按启发取最近、只看 `canPass`、目标外回落朝向），点击移动与 Agent 逐格移动都调用它；关闭增强寻路时可复现「直线往上冲、踩门进屋」。
- 补 `canPass(x, y, d)`、`isMapPassable`、`isCollidedWithCharacters`、`isThrough`；`Game_Map.isValid / deltaX / deltaY / distance`；`Game_Event` 的 `x / y`、`page / isTriggerIn / isNormalPriority`（门为「角色下」接触事件，NPC 为普通优先级）。
- `Scene_Map` 与 RM 一致：取到方向但没走动（撞墙、对着 NPC）就清除目的地。
- `TouchInput` 记录按下状态与指针坐标（`_onTrigger / _onMove / _onRelease / isPressed`，按下时才跟随移动），画布 `mousedown` 触发，`window` 的 `mousemove / mouseup` 跟随与松开。`Scene_Map.processMapTouch` 照 RM：点击当帧设目的地（行走中也会改目标）；按住时 `_touchCount` 计数，满 15 帧后每帧把目的地设为指针所在格。增强寻路以目标变化重新规划，因此拖动时同样沿完整路线走。

## 文案

`nav.enhance`（能力增强 / Enhancements / 能力強化 / 능력 강화）、`edit.enhancePage`、`edit.flagSmartPath`（增强寻路 / Smart pathfinding / スマート経路探索 / 스마트 길찾기）、`edit.flagSmartPathDesc`，四种语言。日志中文。

## 测试

- `__tests__/plugins/cheat/runtime/pathfinding.spec.ts`：空地直线；墙迫使绕行（原版 12 步限制会失败的距离）；屋子：屋后可达、门为会触发的格时绕开、点门本身可进入；屋顶走不到时停在最近可达格且不经过门；单向通行；循环地图跨边界走短边；走不到时 `reached = false`；256×256 全图展开可完成。
- `__tests__/plugins/cheat/runtime/smart-path.spec.ts`：用桩 `$gameMap` / `Game_Player` 验证接管后按路线返回方向、缓存命中不重算、下一步被挡或接触事件走上路线时重算、再次点击同一走不到的格会重算、走不到时通道打开后继续前往、新路线首步走不通时交还原函数、相邻 NPC / 隔柜台时返回朝向、走不到时只在挡住的一边转身、穿墙 / 调试穿透 / 载具 / 关闭 / 小数坐标时调用原函数、换地图后重新规划、已抹除 / 无当前页 / 空页事件不绕开、规划期间替换的碰撞判定（含实例自有属性、规划抛错时）原样还原、其他插件接管寻路时让出并只提示一次、重复安装时采用新开关、`canPass` 在实例或基类上被改写时仍生效。`pathfinding.spec.ts` 另含时间预算用尽时停止搜索。
- `__tests__/components/settings/enhance-settings-view.spec.tsx`：默认开启（含旧设置缺字段）、页面开关写入 `smartPathEnabled`。
- `__tests__/components/settings/game-edit-assist-pane.spec.tsx`：Web 与局内浮层的「辅助」分区一致（含能力增强）。
- `__tests__/plugins/cheat/runtime/walk-demo-click-move.spec.ts`：jsdom 中加载整个 walk demo（`data.js / objects.js / game.js`，假定时器驱动帧循环），经 `RunCheats.ensureSmartPathHook()` 安装：无会话状态也已安装；行走途中点击新位置立即改道（开 / 关增强寻路）；绕屋途中再改点；点屋后绕路不进门；按住拖动跟随指针、15 帧后才重新瞄准、拖到屋后绕路、松开后移动指针不影响目的地。
- 引擎相关行为在 walk-game demo 中手测：屋后、屋顶、点门、点 NPC、移动 NPC 挡路、按住拖动。
