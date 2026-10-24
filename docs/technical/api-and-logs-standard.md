# 代码、注释、日志与接口英文规范 (Code, Comments, Logs & API Standard)

- **状态**：正式规范
- **版本**：v1.1
- **适用范围**：源码与注释、构建与开发脚本（`Makefile`、`scripts/`）、Next 服务端 / HTTP API 路由、MCP 协议工具层、后台服务与守护进程

---

## 1. 规范背景与设计原则

为保证 Chaya 架构与源码生态对所有开发者（包含全球协作者与第三方开发者）的友好性、避免编码乱码与多语言沟通分歧，同时便于服务端统一日志归集与大模型分析，确立以下规范：

1. **代码注释与工程备注全英文 (English for Code Comments & Annotations)**：
   - **源码行内注释**（`// ...`）、**JSDoc / TSDoc 函数类描述**（`/** ... */`）、类型备注必须统一使用清晰规范的英文书写；
   - **工程配置与辅助说明**（如根目录 `Makefile` 中的 recipe 注释及帮助、自动化构建脚本顶部说明）一律使用英文；
   - 杜绝在源码注释中写入中文，避免给其他开发者阅读与维护带来障碍。
2. **脚本、Makefile 与 CLI 工具控制台输出全英文 (English for Scripts & CLI Outputs)**：
   - `Makefile` 交互说明（如 `make help`）以及开发/构建脚本（`scripts/dev.mjs`、`scripts/start.mjs` 等）的控制台打印必须为纯英文；
   - 构建过程警告、错误追踪及进度提示一律输出英文日志。
3. **后台与进程日志全英文 (English Backend Logs)**：
   - 所有非 Web UI 相关的代码（`services/`、`initializer/`、`lib/`、`plugins/src/loader`、构建脚本等）中的日志（`console.log`、`console.warn`、`console.error`、`logger`）统一使用英文；
   - 包含模块标签前缀，例如 `[translate] Chunk 1 completed in 2.3s`、`[storage-daemon] Acquired exclusive lock`。
4. **接口非 UI 文本与异常全英文 (English for Machine & Non-UI Boundaries)**：
   - 所有 HTTP API 响应信封（`apiError` / `apiBadRequest` / `apiNotFound`）中的 `message` 字段必须使用规范英文；
   - 所有 MCP 协议返回（JSON-RPC 错误提示、Tools 返回给模型的 `hint`、`where`、字段解释等）必须使用英文；
   - 后台服务、底层业务抛出的异常 `throw new Error(...)` 消息统一使用英文。
5. **最终用户文案与 i18n 资源严格解耦 (Strict Separation from UI i18n)**：
   - 面向最终玩家与用户的界面语言**必须且仅能**保留在前端多语言词典中（`lib/i18n/messages/{zh,en,ja,ko,cht,de,es,fr,ptBR,ru}.ts`）；
   - API 报错遵循 `{ ok: false, error: { code: string, message: string } }` 结构；前端根据 `error.code` 进行多语言映射展示，未命中时方将服务端英文兜底展现；
   - 开发者内部代码/日志/注释与面向用户的产品多语言文案界限清晰，不得在内部代码逻辑中混用业务翻译。

---

## 2. API 响应信封规范

使用 `@/initializer/response` 构造错误响应：

```typescript
import { apiBadRequest, apiError, apiNotFound } from '@/initializer/response'

// 推荐：统一规范的英文错误短语
return apiError(409, 'GAME_CHANGED', 'Game has changed, please reload settings')
return apiBadRequest('Missing source text or localesKey', 'SAVE_ITEM_EMPTY')
return apiNotFound('Cache entry not found', 'CACHE_NOT_FOUND')
```

---

## 3. MCP 工具规范

MCP 工具的返回值与抛出异常由模型直接阅读与解析，因此：

- 校验失败抛错：`throw new Error('Missing parameter gameRoot')`
- 状态提示：`{ launched: true, hint: 'ChayaAgent will connect a few seconds after game launch; verify with chaya_live_games.' }`
- 描述信息：所有 Tool annotations、Schema description 以及返回的枚举状态说明全使用英文。

---

## 4. 常见错误代码与英文对照字典

| Error Code          | Standard English Message                                                                | 说明                       |
| :------------------ | :-------------------------------------------------------------------------------------- | :------------------------- |
| `BAD_REQUEST`       | `Request body must be valid JSON`                                                       | 请求体非法                 |
| `GAME_CHANGED`      | `Game has changed, please reload settings`                                              | 当前游戏已发生变动         |
| `SAVE_ITEM_EMPTY`   | `Missing source text or localesKey`                                                     | 缺少原文字符串或本地化 Key |
| `GAME_UNAVAILABLE`  | `Game path unavailable`                                                                 | 游戏路径无法访问           |
| `CACHE_NOT_FOUND`   | `Cache entry not found`                                                                 | 缓存未找到                 |
| `SHELL_JOB_RUNNING` | `Downloading and installing NW.js, please wait until the download center task finishes` | 壳安装进行中冲突           |
| `LOCAL_ONLY`        | `Feature is only available in Chaya App or local service`                               | 仅本机环境支持的能力       |
