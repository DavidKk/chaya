# initializer

本机 API 的**注册与返回出口**（对齐工单服务 `initializer/{controller,response}`，管理会话 / 插件受限令牌鉴权）。

| 文件            | 职责                        |
| --------------- | --------------------------- |
| `response.ts`   | `apiOk` / `apiError` / pack |
| `controller.ts` | `defineApiRoute`            |
| `types.ts`      | handler 上下文类型          |

```ts
import { defineApiRoute } from '@/initializer/controller'
import { apiOk, apiBadRequest } from '@/initializer/response'

export const POST = defineApiRoute('post:/api/example', async ({ request }) => {
  if (bad) return apiBadRequest('…')
  return apiOk({ item: 1 })
})
```

约束：新路由用 `defineApiRoute`；JSON 用 `apiOk` / `apiError`（或抛 `apiErrorBody`），避免手写 `NextResponse.json({ ok: … })`。
