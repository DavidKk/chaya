# Agent 单请求多句打包与字符上限技术方案

- 状态：已实现；本轮修正跨分片积累、请求并发与结果窗口的边界。
- 日期：2026-10-27。
- 关联需求：[Agent 单请求多句打包需求](../translation-agent-prompt-batching.md)。

## 1. 架构与流程总览

```text
[待译文本队列] (Pending Items)
      │
      ▼
┌──────────────────────────────────────────────┐
│  Agent Batch Accumulator (多句贪心打包器)     │
│  - 贪心累加至 maxChars (默认 3000)             │
│  - 超长单句自然边界拆分 (按标点/段落，保护控制码) │
└──────────────────────┬───────────────────────┘
                       │
                       ▼ 打包后的 Batch [Item1, Item2, ... ItemN]
┌──────────────────────────────────────────────┐
│  Ollama Multi-Item Prompt Builder            │
│  - 结构化带序号提示词 (1. 原文 \n 2. 原文...)   │
│  - 严格保留控制码占位符说明                      │
└──────────────────────┬───────────────────────┘
                       │ HTTP Request (并发受 concurrencyLimit 限制)
                       ▼
┌──────────────────────────────────────────────┐
│  Ollama / Agent Model Inference              │
└──────────────────────┬───────────────────────┘
                       │ HTTP Response
                       ▼
┌──────────────────────────────────────────────┐
│  Response Parser & Control Validator         │
│  - 按序号/行号精准拆解为 N 条译文               │
│  - 校验每条控制符 __C\d+__ 与有用性            │
└───────┬──────────────────────────────┬───────┘
        │ 成功匹配                     │ 解析失败 / 缺行 / 校验失败
        ▼                              ▼
┌───────────────────────────┐    ┌───────────────────────────┐
│  整体落库与结果收集         │    │  降级回退 (Fallback)       │
│  - 写入缓存与游戏文件      │    │  - 退回为单句重试队列      │
│  - 产生聚合批次活动日志    │    │  - 保障 0 错位、0 丢失    │
└───────────────────────────┘    └───────────────────────────┘
```

## 2. 核心模块与实现细节

### 2.1 设置项语义与 i18n 变更

在 `lib/translate/engines.ts` 及 UI 组件中保留 `maxConcurrentChars` 字段键，但将其业务语义从“并发流控水位”明确为“单请求打包字符上限”：

- `concurrencyLimit`: 单 Agent 实例允许的最大并行网络请求数（1～40）。
- `maxConcurrentChars`: 单个网络请求内打包的最大字符数（500～40,000，默认 3000）。
- 更新多语言配置：
  - `zh`: `单次请求最多字符数`，`单个翻译请求允许打包的字符总数上限（范围 {min}～{max} 字）。`
  - `en`: `Maximum characters per request`, `Maximum character limit packed into a single translation request ({min}–{max} chars).`
  - 同步更新 `cht.ts`, `ja.ts`, `ko.ts`, `de.ts`, `fr.ts`, `es.ts`, `ru.ts`, `ptBR.ts`。

### 2.2 打包累加器（Batch Accumulator）

`services/translate/agent-batching.ts` 提供纯打包、拆句与响应解析，`agent-translate.ts` 管理跨事件循环的请求积累：

```typescript
export type BatchUnit = {
  id: string | number
  src: string
  plain: string
}

export function packBatches(items: BatchUnit[], maxChars: number): BatchUnit[][] {
  const batches: BatchUnit[][] = []
  let current: BatchUnit[] = []
  let currentChars = 0

  for (const item of items) {
    const chars = Array.from(item.plain || item.src).length
    if (current.length && currentChars + chars > maxChars) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(item)
    currentChars += chars
  }
  if (current.length) batches.push(current)
  return batches
}
```

### 2.3 超长单句自然边界拆分与重组

当单句 `Array.from(src).length > maxChars` 时：

1. 提取所有 RPG Maker 转义符与 `__C\d+__` 占位符，记录其在字符串中的字符区间；
2. 寻找不在控制符区间内的分句点（换行、句末标点或分句标点），选择字符上限以内最靠后的安全边界；
3. 将超长单句切分成若干符合字符限制的子句分别送翻；
4. 翻译完成后按原始标点拼接组合，并校验全句占位符。
5. 若一个完整子句仍超过上限，明确返回“没有安全分句点，请增大单次请求上限”；不定长截断，也不发送超过上限的原句兜底请求。控制码位置始终相对于完整原文，Unicode 字符按码点计数。

### 2.4 Prompt 构建与解析格式

针对大模型的多行翻译 Prompt，采用序号前缀格式：

```text
你是游戏文本翻译器，把日文或英文原文译成简体中文。
文中的占位符（如 __C0__、__C1__ 等）必须原样保留原有格式。
请按相同序号逐行输出对应的简体中文译文，不要多行合并，不要遗漏序号，不要添加任何解释：

[1] 第一句原文
[2] 第二句原文
[3] 第三句原文
```

解析器解析步骤：

1. 正则匹配 `^\s*(?:\[(\d+)\]|(\d+)[\.、：:])\s*(.*)$` 逐行提取序号与译文；
2. 若提取到的译文条目数与输入行数一致且序号一一对应，则视为结构解析成功；
3. 对每条译文分别通过 `isUsefulTranslation` 和控制符完整性校验；
4. 若任意一条未能对齐或校验失败，将失败项分离出来退回到重试队列，不让整包阻塞。

### 2.5 调度器与活动日志集成

在 `seed-session.ts` 调度循环中，缓存扫描与 Agent 请求积累独立推进：

- 源条目仍逐条经过缓存和权限校验。Agent 的源条目准入预算为 `单次字符上限 × (请求并发数 + 1)`，另设 4096 条在途条目保护；不再用结果窗口的 4/40 条限制请求打包。
- `agent-translate.ts` 按实例、模型、上下文、配置及任务作用域隔离队列。下一条放不下时先提交当前包，下一条保留到新包；达到字符上限立即提交。
- 不满包在 250ms 后检查：若缓存扫描仍可能补充未命中项，继续等待；缓存扫描结束或调度暂停后提交尾包。从首条入队起最多等待 5 秒，后续入队不会延长此期限。
- `liveTranslateTexts` 不再为 Agent 的每条源文本占用 HTTP 并发槽；只有打包完成后由 `scheduleOllama` 限制真实请求并发。关闭并发时严格为 1。
- 同请求共享取消信号，但只有全部源条目取消才中断请求。某条因缓存命中取消，不影响其他条目的译文；失败回退跳过已取消项。
- 活动日志分别记录 `[Agent] 请求已提交：333 条（2997 字符）` 和完成结果窗口。结果窗口可能只含部分请求结果，其条数与字符数不能用于判断 HTTP 请求大小。
- 缓存结果窗口保持最多 40 条或 10,000 字符的独立上限，并记录提交原因：容量上限、缓存扫描结束、引擎结果返回、全部完成、中断或 5 秒等待上限。缓存尾窗口小于上限允许直接提交，不要求等待其他引擎完成。

## 3. 测试与验证计划

1. **单元测试**：
   - 验证 `packBatches` 贪心合并与边界切分；
   - 验证多行带序号 Prompt 的解析器容错（处理模型前导空行、序号格式差异）；
   - 验证超长单句自然边界拆分与拼接重组；
   - 验证解析失败时的降级回退。
2. **端到端集成**：
   - 本地 `seed` 任务运行，验证日志显示为预期的多条大字符聚合，确认不再出现单条 9 字符刷屏。
3. **全流程门禁**：
   - 运行 `pnpm ok` 确保格式、代码检查、类型检查、全量单元测试与编译构建完全通过。
