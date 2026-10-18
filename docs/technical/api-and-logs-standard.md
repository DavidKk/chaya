# API 接口、MCP 与后台日志英文规范 (API, MCP & Logs Internationalization Standard)

- **状态**：正式规范
- **版本**：v1.0
- **适用范围**：Next 服务端 / HTTP API 路由、MCP Server 与协议工具层、后台服务进程（Extract / Translate / Agent / Shell 等）与 CLI / 脚本

---

## 1. 规范背景与设计原则

为保证 Chaya 架构的跨平台一致性、便于多语言支持、统一日志归集分析（如日志监控、LLM Agent 调度反思、MCP 工具链消费），确立以下规范：

1. **接口非 UI 文本全英文 (English for Machine & Non-UI Boundaries)**：
   - 所有 HTTP API 响应信封（`apiError` / `apiBadRequest` / `apiNotFound`）中的 `message` 字段必须使用规范英文；
   - 所有 MCP 协议返回（JSON-RPC 错误提示、Tools 返回给模型的 `hint`、`where`、字段解释等）必须使用英文；
   - 任何由后台服务、业务层抛出给 API / MCP 捕获的 `throw new Error(...)` 消息统一使用英文。
2. **客户端本地化解耦 (Client-Side i18n Mapping)**：
   - API 报错遵循 `{ ok: false, error: { code: string, message: string } }` 结构；
   - 客户端 UI 若需给玩家展示多语言友好的错误，根据标准的 `error.code` 走前端 i18n 映射显示；若未命中映射，直接将服务端的英文 `message` 作为安全兜底展现，杜绝出现混乱的跨语言混杂。
3. **后台与进程日志全英文 (English Backend Logs)**：
   - 所有非 Web UI 相关的代码（`services/`、`initializer/`、`lib/`、`plugins/src/loader`、构建脚本等）中的日志（`console.log`、`console.warn`、`console.error`、`logger`、`log?.`）一律统一使用英文；
   - 包含模块标签前缀，例如 `[translate] Chunk 1 completed in 2.3s`、`[save-locales-item] Failed to backup original locales file`。

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
