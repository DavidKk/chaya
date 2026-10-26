# Agent 单请求多句打包与字符上限技术方案

- 状态：技术方案草案，待评审。
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

在 `services/translate/agent-translate.ts` 或对应适配器层引入批处理辅助：

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
2. 寻找不在控制符区间内的分句点（优先 `\n`，次优 `。！？……`，次优 `；，、`）；
3. 将超长单句切分成若干符合字符限制的子句分别送翻；
4. 翻译完成后按原始标点拼接组合，并校验全句占位符。

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

在 `seed-session.ts` 调度循环中：

- 当选定 Agent 引擎时，调度器一次性取出最多达到 `maxChars` 的待译任务集合，打包后调用 `liveTranslateTexts`。
- `result-window.ts` 收集器接收整批完成的项，统一提交给 `pushLog` 生成如 `[Agent] #1289：35/35 条（2,800 字符）完成` 的聚合日志。

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
