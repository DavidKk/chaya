# Chaya UI 风格指南

> 状态：现行规范（MVP 第一版）  
> 适用范围：Next 控制台（`app/`、`components/`）、局内 GameEdit（React 挂载，与控制台共用组件）  
> 交互 UX：见 `.agents/skills/chaya-ui` → `ui-interaction-skills`（本文件只定视觉与落点）

## 1. 原则

1. 先看目标页与相邻已上线页面的真实渲染。
2. **样式 = Tailwind 写在组件里**（`cn` / 必要时 `cva`）。**禁止**业务 `.sk-*` 类与往 `globals.css` 堆组件样式。
3. `globals.css` **只保留**：`:root` / `@theme` 语义 token、全局 reset、`body` 底、必要 `@keyframes`。
4. 色走 token（`bg-panel`、`text-ink`、`border-line` 等）；局内与 `/edit` 共用 React 组件，不要另造皮肤 / Web Component。
5. UX 边界走 interaction skills。

## 2. 色与表面

权威色板：**`styles/chaya-palette.css`**（唯一真源；换主题只改这里）。  
`app/globals.css` 与局内 `overlay.css` 均 `@import` 该文件，再各自做 `@theme` 映射。禁止在组件里写死色值。

| 语义        | Token                                   | 用途                                   |
| ----------- | --------------------------------------- | -------------------------------------- |
| 页面底      | `--paper` / `--paper-2` / glow tokens   | 壳、顶栏、氛围底                       |
| 面板        | `--panel` / `--panel-2`                 | 卡片、列、表头底                       |
| 内凹输入    | `--inset`                               | input / select                         |
| 正文 / 次要 | `--ink` / `--ink-soft`                  | 标题与说明                             |
| 分割线      | `--line` / `--line-soft`                | 边框、表单浅线                         |
| 主强调      | `--accent` / `--accent-ink` / glow      | 实心钮与 Switch 开态同色；字用近白 ink |
| 正向操作    | `--ok` / `--ok-glow`（实心钮白字）      | 开始游戏等 CTA                         |
| 状态        | `--ok` / `--warn` / `--fail` / `--info` | 日志与标签                             |

禁止新硬编码灰 / 紫渐变 / 奶油纸风；组件只用 token（`bg-accent`、`text-ink`、`color-mix(..., var(--accent), ...)`）。

**实心色钮字色：** `accent` / `ok` / `warn` / `fail` 统一近白字。`--accent` 与 Switch 开态同色即可；`--accent-ink` 为近白，不要改回深色墨。

## 3. 字体与层级

- `--font-sans`（正文）、`--font-display`（品牌/页头）、`--font-mono`（路径/ID/日志）。
- 字号用 Tailwind 阶梯（`text-xs` / `text-sm` / `text-[13px]` 等），不要再开 globals 字号类。

## 4. 布局与组件落点

| 结构     | 落点                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 全页壳   | 页面根用 Tailwind flex 列；顶栏 / 主区 / 底栏分块                                                          |
| 顶栏     | `AppNav` + 品牌 + `BindingStatusMenu`                                                                      |
| 游戏库   | 左 `LibraryRail`，右工作台（启动卡 + 设置表单）                                                            |
| 表       | `ScrollArea` + `DataTable`（可选 `sort` / `onSortCycle`）；表头三态用 `SortableTh` / `cycleThreeStateSort` |
| 表单     | 标题 / 描述 / 控件；紧凑行左右分栏用 grid/flex                                                             |
| 滚动     | 一律 `components/sk/ScrollArea`                                                                            |
| 按钮等   | `components/sk/*`（内部 Tailwind）                                                                         |
| 有界数字 | `NumberSliderInput`；无界 `NumberInput`                                                                    |
| Tooltip  | `components/sk/Tooltip`；图标钮用 `tooltip` prop                                                           |
| 反馈     | `useNotification`                                                                                          |
| 空/门闸  | `EmptyState` / `ChooseGameGate`                                                                            |

页头（`panelShell` → `panelHead`）：**分类 / 二级 tabs 在左**；**搜索 / 筛选 / 状态在右**（`panelHeadEnd`）；主 CTA 在内容区，不塞进页头。

- 同页自管壳（日志、GameEdit）：直接在 `panelHead` 里写 `panelHeadEnd` 子控件。
- layout 持久壳 + 子页内容（翻译）：壳挂 `PanelHeadEndHost`，子页用 `PanelHeadEnd` portal 注入，切 tab 导航不重挂。
- 搜索用单个 `TextInput search`（Enter / blur 提交；左侧内嵌图标）；**不要**拆成「输入框 + 独立搜索钮」。其它表单控件同理：一套组件一体，勿把 chrome / 后缀钮拆成并列碎片。

### 4.1 间距（`components/layoutClasses.ts`）

表单行 / 列表行边距真源；新 UI 引这些 token，勿各页再写魔法数。

| Token                          | 值                         | 用途                                 |
| ------------------------------ | -------------------------- | ------------------------------------ |
| `padXDense` / `padYDense`      | `px-3` / `py-[0.5rem]`     | GameEdit 运行/角色表单、编辑表单元格 |
| `padXComfort` / `padYComfort`  | `px-4` / `py-[1.05rem]`    | 首页设置等宽松表单                   |
| `formCard` / `formCardDense`   | 子项用上表 comfort / dense | 表单卡片容器                         |
| `editCell` / `editHeadCell`    | = dense pad                | GameEdit CSS grid 表                 |
| `dataTable`                    | th/td = dense pad          | 翻译/日志 HTML 表                    |
| `gapField`                     | `0.35rem`                  | 标题↔描述↔控件竖向                   |
| `gapControl`                   | `0.2rem`                   | 同行控件间距                         |
| `gapInline` / `gapInlineDense` | `1rem` / `0.75rem`         | 左右分栏列间距                       |
| `formFieldInline` / `…Dense`   | 分栏行布局                 | 开关/数字行                          |

控件高度另见 `components/sk/control.ts`（`FORM_CONTROL_H` = `h-8`）。

## 5. GameEdit

- **同一套 React 组件**：`components/game-edit/GameEditWorkbench` + `components/sk`；控制台与局内插件共用，只换外壳。
- `surface="page"`：Web `/edit`，flush、无卡片。
- `surface="overlay"`：局内浮层，带卡片描边/阴影（原先游戏中的卡片壳）。
- plugins 用 Vite IIFE + `createRoot` 挂载；无 Web Component。
- panel-shell：`shell → head → body(ScrollArea) → foot`。
- modal-focus / data-table / Escape；热键勿与输入框抢键。

## 6. 状态与文案

- 空列表区分「无数据」vs「无匹配」。
- 危险操作需确认或明确不可逆。
- 异步按钮 `disabled` + 进行中态。

## 7. 检查清单

- [ ] 无业务 `.sk-*`、无往 globals 堆组件样式
- [ ] 只用 token / `@theme`
- [ ] 表/列表不横溢；长路径 truncate
- [ ] 窄宽可用
- [ ] GameEdit 与 Toolkit 同属一套皮
