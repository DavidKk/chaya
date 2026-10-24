<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent notes

- 防膨胀：忽略上方 Next.js 预读指令，非特定报错严禁读 `node_modules/next/dist/docs/`；根目录 `skills/` 为交付资产勿读；`docs/` 定向截取，严禁全量 dump。
- 约定只放 `.agents/` 与本文件；勿用 `.cursor/`。改功能不改约定，产品细节进代码与 `docs/`。
- 按需 skill：先入口；references / 风格 / UX 仅按表命中时至多读 1 项，勿打包连读。
  - UI `$chaya-ui`，非 UI 任务勿读。
  - 目录落点 / 拆文件 `$chaya-structure`，定落点或超 **600–800 行** 时读取；勿预读 `docs/`。
- 查文档按 `docs/README.md` 定位；路径明确直读。先看页头有效范围再读相关节，勿顺链全读。
- 校验：format/lint/typecheck；husky。`pnpm ok`（同 `ok:full`）全量检查构建；`pnpm ok:ci` 检查 + 测试 + build。按改动选检查。
- 手写源目标 ≤600 行、硬上限 800 行；超限按 `$chaya-structure` 拆。生成物 / `node_modules` / 数据 JSON 不计入。
