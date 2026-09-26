---
name: chaya-structure
description: >-
  定目录落点、新建模块、或拆分过长源文件时使用；路径已明确的普通改文件不使用。
  勿预读 docs/ 冷藏文档定落点。普通改需求时不要改本 skill。
---

# Chaya 结构落点

定落点 / 拆过长文件时**读**本 skill。路径已明确的普通改文件不要读。  
UI 走 `$chaya-ui`。

## 何时改本 skill（硬）

- **默认禁止**在改需求 / 修 bug / 做功能时改 `.agents/skills/**`、本文件或 `AGENTS.md`。
- **仅当**研发明确要求改 Agent 约定（落点表、行数档、边界）时才改；产品细节（具体子路径、API 名、文案）写代码与 `docs/`，不写进 skill。

## 加载规则（硬）

- 默认只读本文；够用就停。勿预读 `docs/`，勿一次打开全部 references。
- 不够时按下表开**一条**；未命中不打开。

| 需要什么                 | 打开                                                 |
| ------------------------ | ---------------------------------------------------- |
| 落点争议 / 新建模块      | [`references/placement.md`](references/placement.md) |
| 将超 600–800 行 / 怎么拆 | [`references/file-size.md`](references/file-size.md) |

## 速查

| 职责                   | 落点                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| 品牌 / 端口 / 路径常量 | `constants/`（改名只动这里）                                                                              |
| API 注册与信封         | `initializer/`（`defineApiRoute` / `apiOk`）                                                              |
| 域逻辑                 | `services/{domain}/`（含 `translate` / `extract` 管线 CLI）                                               |
| 纯约定 / 无 I/O        | `lib/`                                                                                                    |
| 页面 / API             | `app/` → `services/`                                                                                      |
| 基础控件               | `components/sk/`                                                                                          |
| 功能 UI                | `components/`（GameEdit 共用 → `components/game-edit/`）                                                  |
| 游戏插件               | `plugins/`                                                                                                |
| Agent 约定             | `.agents/`（禁止 `.cursor/`）                                                                             |
| 本机运行时数据         | `data/` 下**按用途分子目录**（禁止直接堆在 `data/` 根）；路径见 `lib/game/toolkit-data.ts` + `constants/` |

- 行数：目标 ≤600，硬上限 800（手写源）；生成物 / `node_modules` / 数据 JSON 不计入。
- 组件 PascalCase 同名导出；Hook / 工具 camelCase。重命名用 Move / `mv`。

## 编写时

先选顶层 → 可见性 → 落文件；超 600 行先拆。不要逐案请示落点。
