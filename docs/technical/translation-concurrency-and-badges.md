# 翻译引擎全并发调度、状态探活与徽标渲染技术方案

- 状态：历史方案。调度设计与代码示例已由[翻译调度优化基线](../translation-scheduling.md)替代，不代表当前实现；状态探活与徽标约定仍按实际代码维护。
- 日期：2026-10-22。
- 需求文档：[翻译引擎并发调度与引擎属性状态徽标优化需求](../translation-concurrency-and-badges.md)。
- 关联方案：[翻译管线核心设计](translation-pipeline.md)、[macOS 原生神经翻译技术方案](apple-native-translation.md)。

## 1. 架构设计与调度链路

翻译流水线采用“缓存分层查优先级，未命中引擎全并发”的设计理念。

```
                    ┌─────────────────────────┐
                    │      待翻译文本 src     │
                    └────────────┬────────────┘
                                 │
                   [ 1. 本作专属缓存匹配 ] ──(命中)──> 返回译文
                                 │ (未命中)
                   [ 2. 全局共享缓存检索 ] ──(命中)──> 返回译文
                                 │ (未命中)
                  [ 3. 敏感词 & 引擎列表过滤 ]
                                 │
             ┌───────────────────┴───────────────────┐
             │       Promise.any 并发竞争任务        │
             ├───────────────────┬───────────────────┤
             │ Apple 原生神经翻译│ Bing 公网翻译     │ ...（已开启引擎）
             │ (10~30ms 极速响应)│ (网络 I/O)        │
             └───────────────────┴───────────────────┘
                                 │
                   (首个有效译文胜出 Winner)
                                 ├──> 双写回填：本作 ndjson + 全局 sqlite
                                 └──> 即时返回替换游戏内文本
```

### 1.1 调度器实现（liveTranslateTexts）

在 `services/translate/live-translate.ts` 中，彻底移除了历史串行 `for...of` 逐个尝试的代码，采用 `Promise.any` 调度模型：

```typescript
/* Translate concurrently across all enabled engines: no priority during translation, first valid result wins. */
const langPair = opts?.sourceLang || opts?.targetLang ? { from: opts?.sourceLang, to: opts?.targetLang } : undefined
const tasks = tryEngines.map(async (engine) => {
  const rawZh = await translateWithEngine(engine, sendText, opts?.local, agents, langPair)
  const zhCore = translationCoreForCache(rawZh, guard)
  const zh = restoreForTranslate(rawZh, guard)
  if (!isUsefulTranslation(src, sendText, rawZh, zh, opts?.targetLang)) {
    throw new Error(`${engine}: 未得到译文`)
  }
  return { engine, rawZh, zhCore, zh }
})

try {
  const winner = await Promise.any(tasks)
  // 提取胜出者译文与标签，执行缓存写入并返回
} catch (aggregateError) {
  const errs = aggregateError instanceof AggregateError ? aggregateError.errors.map((e) => (e instanceof Error ? e.message : String(e))) : [String(aggregateError)]
  items.push({ src, zh: null, error: errs.join('；') || (engines.length ? '翻译失败' : '未开启任何翻译平台') })
}
```

### 1.2 异常处理与快速短路保护

1. **空引擎短路防御**：若用户未开启任何外部引擎或敏感文本无可用 Agent，在组装 `tasks` 之前直接返回 `{ src, zh: null, error: '未开启任何翻译平台' }`，杜绝向 `Promise.any([])` 传递空数组引发无意义的抛错开销。
2. **异常聚合（AggregateError）**：当所有并发引擎均失败时（例如网络离线且本地语言包缺失），捕获 `AggregateError` 并格式化拼接每个引擎的失败详情，便于用户直观定位故障。

## 2. 引擎开关解耦与独立状态管理

### 2.1 引擎开关完全解耦

系统严格保证各个引擎之间无级联绑定关系：

- 在 `TranslateEngineRail` 中，用户操作单个 Switch 触发 `persist({ switches: { [id]: checked } })`，后端通过 `mergeEngineState` 进行局部 Patch 合并。
- 修正显式 `engines: []` 的解析逻辑：当调用方明确传递空数组时，不再回退到默认开启的开关，确保离线测试或纯缓存模式下绝对不发起网络调用。

### 2.2 存储与持久化

- 本地平台开关（Bing / Google / Apple / Bergamot）保存在游戏内容目录的 `*-trans.switches.json` 中；
- 用户自定义 Agent 实例保存在 `data/translate/agents.json` 中；
- 胜出译文写回时，引擎 Tag 真实记录胜出者身份（如 `live:apple`、`live:google`、`live:agent:xxx`），保证缓存回溯清晰可查。

## 3. 引擎状态探活与徽标渲染

### 3.1 离线引擎就绪探活契约

通过 `/api/translate` 暴露轻量探活端点：

- `mode: 'apple-status'`：调用 `appleTranslator.checkStatus(source, target)`，通过标准输入输出向原生守护进程发送 JSON-RPC `check` 请求，探测 macOS 系统中是否已安装当前语言对的离线模型包；
- `mode: 'bergamot-status'`：调用 `bergamotTranslator.checkStatus(source, target)`，检查二进制可执行文件与离线词典目录的存在性。

### 3.2 徽标呈现与视觉排版修复（Review 重点）

在 `TranslateEngineRow.tsx` 中：

- 历史实现将 `badge` 作为 `grid` 容器的第 4 个直接子元素，破坏了三列网格（`grid-cols-[1.25rem_minmax(0,1fr)_auto]`）布局，导致右侧的操作按钮和 Switch 换行塌陷。
- **重构修复**：将 `badge` 内聚在标题区域（`div className="flex min-w-0 items-center gap-1.5"`）内部，作为标题的同级修饰元素。网格容器恢复为标准的 3 列语义，视觉对齐严谨统一。

### 3.3 徽标视觉规范

- **免费徽标（Bing / Google）**：`<Badge size="mini" tone="accent" dot={false}>`；
- **就绪徽标（本地离线已就绪）**：`<Badge size="mini" tone="ok" dot={true}>`；
- **未就绪徽标（本地离线缺语言包）**：`<Badge size="mini" tone="warn" dot={true}>`。

## 4. 质量保障与测试矩阵

1. **并发竞速胜出测试**：多引擎不同延时并发，断言最快有效者胜出并正确打标写入缓存（`__tests__/services/translate/live-sentence-plan.spec.ts`）；
2. **全引擎失败错误聚合测试**：断言聚合报错字符串中同时包含所有失败引擎的具体原因；
3. **空引擎短路测试**：显式传入 `engines: []` 时，断言立即返回友好提示且不触发任何 Promise 抛错；
4. **全站 i18n 覆盖测试**：10 种语言均配置 `tagFree`、`tagReady`、`tagNotReady` 词条，确保多语言无任何缺失。
