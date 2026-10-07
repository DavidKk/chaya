# 迷你面板管理技术文档

> 状态：已实现，更新于 2026-10-07。用户行为见 [需求文档](../mini-panels.md)。

## 结构

| 职责                                         | 代码位置                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 设置字段、按钮项注册与规范化                 | `lib/game-agent/tool-settings.ts`                                                                                              |
| 设置读写（串行保存、不可用判断）             | `components/game-tools/useToolSettings.ts`                                                                                     |
| 面板 id、开关字段、可见性、切换 / 关闭全部   | `components/game-tools/tool-panels.ts`                                                                                         |
| 按钮项的图标与文案 key（页面与管理面板共用） | `components/game-tools/mini-panel-items.ts`                                                                                    |
| 浮动位置的纯函数（迷你面板与管理面板共用）   | `components/game-tools/floating-placement.ts`（从 `FloatingToolPanel` 抽出）                                                   |
| 管理面板                                     | `components/game-tools/MiniPanelDock.tsx`，游戏内挂载 `plugins/src/cheat/ui/FloatingPanelDock.tsx`                             |
| 设置页                                       | `components/game-tools/MiniPanelsPage.tsx`，Web 入口 `app/assist/panels/page.tsx`                                              |
| 辅助导航                                     | `components/input-assistance/assist-sections.ts`、`components/settings/GameEditAgentSettingsPane.tsx`、`components/AppNav.tsx` |
| 游戏内挂载与快捷键                           | `plugins/src/cheat/ui/App.tsx`、`components/game-edit/run-hotkeys.ts`                                                          |
| 文案                                         | `lib/i18n/messages/parts/panels.ts`（四种语言），类型在 `lib/i18n/messages/types.ts`                                           |

## 设置

工具设置（`ToolSettings`，`GET/PUT /api/integration/game-agent/tools`，`canUseDisk`）新增三个字段，服务端与浏览器缓存都经 `normalizeToolSettings`：

```ts
export const MINI_PANEL_IDS = ['miniMap', 'companion', 'autoSaves', 'quickSaves'] as const
export type MiniPanelId = (typeof MINI_PANEL_IDS)[number]
export const PANEL_DOCK_ITEMS = [...MINI_PANEL_IDS, 'closeAll'] as const
export type PanelDockItem = (typeof PANEL_DOCK_ITEMS)[number]

type ToolSettings = {
  // …原有字段
  panelDockEnabled: boolean // 默认 false
  panelDockHiddenItems: PanelDockItem[] // 默认 []；规范化时去重、去掉未知项，按 PANEL_DOCK_ITEMS 排序
  panelDockOrientation: 'horizontal' | 'vertical' // 默认 horizontal
}
```

- 存「隐藏的项」而不是「显示的项」：以后新增迷你面板时老用户默认就能看到，不需要迁移。
- id 常量放在 `lib/`，服务端规范化也要用；`tool-panels.ts` 从这里取。

### 串行保存

`update` 原本是「读缓存 + patch → 整份 PUT」，服务端整份覆盖。连点两个按钮时，第二次可能在第一次写回缓存前读到旧值，覆盖第一次的改动。改为模块级 promise 队列：每次 `update` 排在上一次之后执行，执行时才读缓存，所以总能拿到上一次的结果。作弊浮层与 agent-ui 两个 React 根在同一窗口共用这个模块，队列也共用。

PUT 只带改动的字段（`{ patch }`），服务端读当前值合并后保存；两个窗口同时改不同字段时互不覆盖。浏览器版的请求桩同样与缓存合并。整份 `{ settings }` 仍被接受。

读取（挂载时、窗口重新获得焦点或回到可见时，以及作弊浮层 3 秒轮询）也会写缓存；同源其他标签页写缓存时经 `storage` 事件即时更新，Web 设置页因此能看到游戏内的改动。模块里记录已开始与进行中的保存次数，读取发出后若有保存开始、或返回时仍有保存在排队，就丢弃这次结果，避免旧值把刚保存的缓存退回去、再被下一次保存整份写回。

### 不可用判断

`useToolSettings` 新增 `unavailable = loaded && error === 'HTTP 404'`（非本机模式），`useMiniPanelSwitches` 改用它。管理面板只在 `loaded && !unavailable` 时显示：一次保存失败或轮询失败只写 `error`，不会让管理面板消失。

## 面板 id

`tool-panels.ts`：

- `MiniPanelId`（四个迷你面板）：`TOOL_PANEL_FRAME` 的键、`FloatingToolPanel` 的 `panel` 参数。
- `ToolPanelId = MiniPanelId | 'panelDock'`：`TOOL_PANEL_IDS = [...MINI_PANEL_IDS, 'panelDock']`，`TOOL_PANEL_FIELD` 增加 `panelDock: 'panelDockEnabled'`。`isToolPanelId` 因此认得 `panelDock`，`App.tsx` 现有快捷键分支不用改。
- `closeAllMiniPanels(update)`：一次 `update` 把四个迷你面板开关写成 `false`；只遍历 `MINI_PANEL_IDS`。
- `anyMiniPanelEnabled(settings)`：「关闭全部」是否可用，只看开关，不看「本次隐藏」。

管理面板没有关闭按钮，`panelDock` 不会进入「本次隐藏」，`toggleToolPanel` 对它等同于翻转开关。

## 按钮项注册

`mini-panel-items.ts` 导出 `PANEL_DOCK_ITEM_META: Record<PanelDockItem, { icon; labelKey; descKey }>`。图标：迷你地图 `LuMap`、旅伴 `LuMessageCircle`（与辅助导航相同）、自动存档 `LuHistory`、快速存档 `LuSave`、关闭全部 `LuPanelTopClose`。管理面板另用拖动柄 `LuGripVertical` / `LuGripHorizontal`，切换方向显示目标排列：当前横向时 `LuRows3`（改为纵向），当前纵向时 `LuColumns3`（改为横向）。

## 浮动位置

`FloatingToolPanel` 中与面板无关的纯函数移到 `floating-placement.ts`：`Frame`、`Placement`、`Viewport`、`Size`、`GUTTER`、`clamp`、`viewport()`、`placementFromFrame`、`readPlacement(key, fallback, edge, requireSize = true)`（管理面板不记尺寸，传 `false`）、`writePlacement`，以及新抽出的 `positionFromPlacement(placement, size, area)`（`layoutFrame` 里按锚点算 x、y 并夹回画面的部分）与 `clampPosition`。抽出时 `FloatingToolPanel` 的定位行为不变；同侧堆叠仍在 `FloatingToolPanel`，管理面板不参与。之后按 UI 统一去掉了迷你面板的外边框与头部分隔线。

## 管理面板

`MiniPanelDock({ settings, update })`。作弊浮层 `App.tsx` 在 `FloatingMiniMap`、`FloatingGameSaves` 之后挂载 `plugins/src/cheat/ui/FloatingPanelDock.tsx`，它只在 `panelDock` 可见、设置 `loaded` 且不 `unavailable` 时渲染管理面板。

- **尺寸**：不可调整，内容撑开。`Button size="mini" variant="plain"`（24 px，触屏 44 px），内边距 4 px、间距 2 px。
- **位置**：存储 key `chaya.panelDock.frame.v1`，格式同 `Placement`；默认 `x: ratio 0.5`、`y: top 8`。每次布局量 DOM 尺寸（`offsetWidth/offsetHeight`），用 `positionFromPlacement` 得到坐标。首帧量出尺寸前 `visibility: hidden`。`ResizeObserver`（存在时）在按钮项或方向变化后重新布局，另监听 `resize` 与 `visualViewport`。切换方向不改 placement，锚点由 `placementFromFrame` 决定（靠右 / 靠下保持边距，否则按比例），与需求 §4.3 一致。
- **拖动**：拖动柄 `pointerdown` + pointer capture；结束（含 `pointercancel`）时保存最后一次移动后的位置（`placementFromFrame` 后 `writePlacement`），不用结束事件的坐标。拖动柄聚焦时方向键移动 10 px（Shift 30 px）；拖动柄为 `role="separator"`（可聚焦、无激活动作），鼠标拖完后失焦。
- **语义**：容器 `role="group"` + `aria-label`（不用 `toolbar`，因为没有方向键漫游且方向键给了拖动柄）。面板按钮 `aria-label` 固定为面板名，状态由 `aria-pressed` 表达，「显示 / 隐藏 {name}」只放在提示里。
- **焦点与按键**（`game-keys.ts`，迷你面板头部按钮与缩放把手共用）：容器 `mousedown` 时 `preventDefault`，鼠标点按钮不转移焦点，之后的方向键 / 回车 / 空格仍交给游戏；键盘 Tab 进入时照常聚焦，这几个键在 React 层 `stopPropagation`，不再传到游戏的 document 监听。迷你面板只对自己的按钮和把手做隔离，不拦整块内容，以免面板里的下拉框（document 上监听方向键）失灵。
- **按钮**：
  - 迷你面板：四个 id 各调用一次 `useToolPanelVisibility(id, settings[field])` 取 `visible`（同时订阅「本次隐藏」），`aria-pressed={visible}`，选中加强调色底；点击 `toggleToolPanel(id, settings, update)`（函数补丁，连点同一按钮每次都按最新值翻转）。
  - 关闭全部：`closeAllMiniPanels(update)`，`!anyMiniPanelEnabled(settings)` 时禁用。
  - 切换方向：函数补丁按最新值翻转 `panelDockOrientation`。
- **提示方向**：`Button` 新增 `tooltipPlacement` 透传给 `Tooltip`；横向 `bottom`、纵向 `right`，放不下时 `Tooltip` 自动翻转。
- **样式**：`fixed z-[60]`，`rounded-md bg-panel/95 shadow-lg`（与迷你面板一致，不加外边框），未悬停 `opacity-40`，悬停或键盘聚焦、触屏 `focus-within` 时不透明。分隔线横向 `h-4 w-px`、纵向 `h-px w-4`，`bg-line`。
- 按钮项全部隐藏时只渲染拖动柄与切换方向。
- 失败处理：`update` 只在成功后写缓存，失败时状态保持保存前，不显示错误。

## 设置页

`MiniPanelsPage({ request })`。Web `app/assist/panels/page.tsx` 用 `useGameAgentRequest().request`；局内浮层 `GameEditAgentSettingsPane` 新增 `section === 'panels'` 分支。`ASSIST_SECTIONS` 末尾加 `{ id: 'panels', labelKey: 'nav.miniPanels', icon: LuLayoutGrid }`。`AppNav` 的「辅助」子菜单改为由 `ASSIST_SECTIONS` 生成（原手写列表缺「游戏存档」、顺序也不一致）。

- 直接复用 `components/game-saves/SaveCard.tsx` 的 `SaveCard`、`settingsRows`、`settingsRow`，本次不搬动。
- 卡片一：标题行开关 `panelDockEnabled`，成功后 `notify.success`；设置区一行 `Select` 写 `panelDockOrientation`。
- 卡片二：标题右侧 `SwitchToggle` 总开关，`checked` 为 `true`（无隐藏项）/ `false`（全部隐藏）/ `'mixed'`（部分隐藏，点击变为开启；ARIA 的 switch 不支持 mixed，此时按 `role="checkbox"` 暴露，`aria-label` 随状态在「全部开启 / 全部关闭」间切换），打开写 `[]`、关闭写全部项；5 行列表（图标、名称、描述、`SwitchToggle`），切换时增删 `panelDockHiddenItems`。
- `unavailable` 时全部控件禁用，卡片一说明换成不可用原因；其他错误显示在卡片二底部 `role="alert"`。`loaded` 之前显示骨架屏。

## 快捷键

`TOOL_PANEL_HOTKEY_ITEMS` 末尾加 `{ panel: 'panelDock', labelKey: 'edit.hkPanelDock', descKey: 'edit.hkPanelDockDesc' }`，id 为 `ui:panel:panelDock`。

## 文案

`MessageTree` 新增 `panels`（`parts/panels.ts`，四种语言同文件）：页面、两张卡片、排列方向、总开关（全部开启 / 全部关闭）、5 个按钮项的名称与描述、管理面板提示（显示 / 隐藏 {name}、关闭全部迷你面板、改为纵向 / 横向排列、拖动）、通知。另加 `nav.miniPanels`、`edit.hkPanelDock`、`edit.hkPanelDockDesc`。日志保持中文。

## 测试

- `normalizeToolSettings`：默认值、未知项与重复项、排序、方向非法值。
- `useToolSettings`：两次 `update` 连续调用，第二次 PUT 带上第一次的改动。
- `tool-panels`：`closeAllMiniPanels` 只写四个迷你面板字段；`anyMiniPanelEnabled` 不受「本次隐藏」影响；`isToolPanelId('panelDock')`。
- `MiniPanelDock`：按设置渲染按钮项与顺序；点击面板按钮、关闭全部、切换方向的 `update` 参数；「关闭全部」禁用态；`aria-pressed` 随「本次隐藏」更新；拖动后写 `localStorage`。
- `MiniPanelsPage`：总开关全部开启 / 全部关闭、单项开关写入的集合；不可用时禁用。
- 需同步修改的现有测试：
  - `tool-panels.spec.tsx`：「迷你面板」分组改为 5 项，最后一项 `ui:panel:panelDock`；
  - `game-edit-assist-pane.spec.tsx`：导航项数 6 → 7；
  - `floating-tool-panel.spec.tsx`：`panel()` 参数类型改为 `MiniPanelId`，断言不变。
