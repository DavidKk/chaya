<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent notes

- Agent 约定只放 `.agents/` 与本文件；**不要**使用 `.cursor/`（rules / skills 等）。
- 功能改动不改 Agent 约定；仅明确要求时修改本文件 / skill。产品细节进代码与 `docs/`。
- 按需 skill：先入口；references / 风格 / UX 仅按表命中时读，勿全读。
  - UI / 交互 `$chaya-ui`。**非 UI 任务不要读取。**
  - 目录落点 / 拆文件 `$chaya-structure`。定落点或将超 **600–800 行** 时读取；勿预读 `docs/` 定结构。
- 需查需求 / 开发文档时按 `docs/README.md` 定位；路径明确则直读。先看页头有效范围，再读相关章节；勿顺链全读。
- 校验：format / lint / typecheck；husky。`pnpm ok`（同 `ok:full`）写盘检查并构建；`pnpm ok:ci` 检查 + 测试 + build，不写盘 format/lint。按改动选检查。
- 手写源目标 ≤600 行、硬上限 800 行；超出按 `$chaya-structure` 拆。生成物 / `node_modules` / 数据 JSON 不计入。
