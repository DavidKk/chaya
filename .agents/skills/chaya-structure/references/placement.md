# 顶层落点与边界

仅在 SKILL 速查不够（新建模块、落点争议）时打开。

**不要**因普通需求改动回写本文；仅研发明确要求改 Agent 落点约定时才改。具体子路径以代码与 `lib/game/toolkit-data.ts` 为准。

## 模块与可见性

- 根也是模块；任意 `{module}/` 可再分：`components` / `hooks` / `config` / `constants` / `utils` / `types` / …
- **全局公共** → 仓库根对应目录
- **模块公共** → `{module}/` 下对应类型目录
- **私有** → 默认可单文件；行多再拆夹；同类很多再收进 `components/` 等（单件不强制进目录）

## 顶层落点

| 职责                                  | 落点                                          |
| ------------------------------------- | --------------------------------------------- |
| 公共常量（品牌 / 端口 / data 子目录） | `constants/`                                  |
| API 注册与返回信封                    | `initializer/`（`defineApiRoute` / `apiOk`）  |
| 本机游戏 / 壳 / 插件 / Finder 等      | `services/{domain}/`                          |
| 跨域、无外部 I/O 的纯约定与工具       | `lib/`                                        |
| Next 路由入口                         | `app/`                                        |
| HTTP API                              | `app/api/{…}/route.ts` → `services/`          |
| 公共基础 UI                           | `components/sk/`                              |
| 页面壳 / 功能 UI / GameEdit 共用      | `components/`、`components/game-edit/`        |
| 翻译 / 抽取管线                       | `services/translate/`、`services/extract/`    |
| 游戏内插件源与构建                    | `plugins/`（GameEdit 无 Web Component）       |
| Agent 约定                            | `.agents/`（禁止 `.cursor/`）                 |
| 本机运行时数据                        | `data/` 下按用途分子目录；禁止堆在 `data/` 根 |

命名：组件文件名与导出同名、PascalCase；禁止 `xx-xx.tsx`。Hook / 工具 camelCase。重命名用 Move / `mv`。

## 边界

- Route / 页面 → `services/` 或 `lib/`；跨通道共用逻辑放 `services/`。
- 禁止无业务价值的薄 re-export；需要 facade 时目录入口只做有意公开导出。
- `'use client'` 可依赖 `services/**` 中纯类型/安全子集；仅 Node（`fs`、装壳、启动）勿被 client 直接 import。
- 禁止 `lib` 反向依赖 `app/`；业务页控件走 `$chaya-ui`。
