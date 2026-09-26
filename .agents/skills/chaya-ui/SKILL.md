---
name: chaya-ui
description: >-
  修改 chaya 的 Web 控制台、GameEdit 浮层或其它前端 UI/交互时使用；
  纯插件逻辑、构建脚本、翻译管线、后端 API、文档与非 UI 任务不使用。
  普通改需求时不要改本 skill。
---

# Chaya UI

修改 Web / GameEdit UI 时**读**本 skill。非 UI 任务不要读。

## 何时改本 skill（硬）

- **默认禁止**在改需求 / 修 UI 功能时改本 skill 或 `references/`。
- **仅当**研发明确要求改 UI/Agent 约定时才改。视觉细则在 style guide；交互细则在 UX skills；组件 API / 文案跟代码走，不回写 skill。

## 加载规则（硬）

- 默认只读本文；够用就停。不要一次读完风格全文 + 全部 UX skill。
- 需要细则时按下表打开；未命中不打开。

| 需要什么                      | 打开                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| 色 / 字 / 布局 / Tailwind     | [`docs/technical/chaya-ui-style-guide.md`](../../../docs/technical/chaya-ui-style-guide.md) |
| 交互（焦点、表、空态、浮层…） | 先 baseline，再按 [`references/ux-routing.md`](references/ux-routing.md) **点名**加载       |
| 仅改文案 / 已有样式微调       | 跟邻近组件即可，不必开上表                                                                  |

## 原则（短）

- 样式：Tailwind 写在组件里；`globals.css` 只放 token。禁止业务 `.sk-*`、另起灰阶/紫渐变皮。
- 复用：控制台与局内 GameEdit **同一套** React 组件（`components/game-edit` + `components/sk`），只换外壳；禁止业务页原生表单与 Web Component。
- 范围：只改本次涉及的页面/组件。

## 完成后（按改动面，非全量 checklist）

有焦点/键盘/表/空态 → 查对应 UX；GameEdit 关面板须恢复游戏焦点。
