<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent notes

- Agent 约定只放 `.agents/` 与本文件；**不要**使用 `.cursor/`（rules / skills 等）。
- **改需求 / 修功能默认不要改 skill 或本文件**；仅当研发明确要求改 Agent 约定时才动。产品细节写代码与 `docs/`。
- 按需技能（**只读入口 SKILL；references / 风格 / UX 按入口表点名再开，勿一次全读**）：
  - UI / 交互 `$chaya-ui`。**非 UI 任务不要读取。**
  - 目录落点 / 拆文件 `$chaya-structure`。定落点或将超 **600–800 行** 时读取；勿预读 `docs/` 定结构。
- UI 视觉真源：`docs/technical/chaya-ui-style-guide.md`（由 UI skill 按需打开）；UX 见 skill 内 `references/ux-routing.md`。
- 基建：`pnpm format` / `lint` / `typecheck`；husky。本地一键：`pnpm ok`（含 `build`）；全量：`pnpm ok:full`；CI：`pnpm ok:ci`（只检查 + `build:plugins`，不写盘 format/lint）。
- 手写源目标 ≤600 行、硬上限 800 行；超出按 `$chaya-structure` 拆。生成物 / `node_modules` / 数据 JSON 不计入。
