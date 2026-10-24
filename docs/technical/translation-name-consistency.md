# 翻译专名句内一致性技术设计

- 日期：2026-10-25
- 状态：草案；未实现。与需求对齐后开工。
- 需求：[专名一致性](../translation-name-consistency.md)（适用 §3，人名表 §4，锁 span §5，存量 §6）；实现前需求与本文一起读
- 关联：[质量设计](translation-optimization.md) 秩 §2、[管线](translation-pipeline.md) live 查找序、[引擎秩](../../lib/translate/cache-engine-rank.ts)
- 按需定位：人名表 §2；锁点与拼接 §3；live / 插件接线 §4；存量 §5；API / UI §6；测试 §7；落点 §8。

## 1. 架构

```text
extract-items 名称行 ⋈ 本作当前权威译文
            │
            ▼
   NameGlossary（lib，无 I/O）
   entries + 变体 + findSpans + stitch
            │
      ┌─────┴──────┐
      ▼            ▼
 liveTranslateTexts   插件 translator.translate()
 cache miss 之后      enrich / plan miss 之后
 protect / 引擎之前    protect / 引擎之前
      │            │
      └──── 只译 gap，按原文空隙 + lock 译文拼接 ────┘

存量：optimize apply-names（预览后写回；gap 可走 live，不经控制台裸引擎直测）
```

不把专名 lock 伪装成 `SentenceRecord` 塞进 planner：planner 仍按标点切句；lock 是发译前的额外半开区间 `[start,end)`。不改 `SENTENCE_RULE_VERSION`，不新建 SQLite 表。

目标语言一期仅 `zh`。`'s` →「的」只在 `to=zh` 时展开；其它目标语言只锁原词、不发明所有格译文。CJK 名最长精确匹配，不用拉丁词边界。

## 2. 人名表

### 2.1 收词

| 项     | 约定                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 源     | `extract-items` 且 `meta.category ∈ {actor, actor_nickname, item, weapon, armor, skill, enemy, state, map}` ⋈ 本作 records / lookup |
| 权威   | **名称行当前权威译文**（与列表展示一致），不限 `manual` / `live:optimize*`                                                          |
| 不入表 | zh 空、zh===src、`reset` 作废键、短于 2 字、单字母拉丁名、非名称类、无 category 的裸 ndjson                                         |
| 匹配   | 更长 `src` 优先；拉丁名单词边界；撇号所有格单独成变体，不用 `\b` 切 `Rei's`                                                         |
| 变体   | 原词；`to=zh` 时 ASCII `'s` / `’s` → 译文+「的」（译文已以「的」结尾则不加）                                                        |

列表把 `Rei` 机翻成「蕾」即可入表并锁句子；不必先手改或跑「优化名称」。名称行被 `manual` / `import*` / `live:optimize*` 定稿后，只更新表，不改写该名称行。

插件进程内没有 extract-items 时：用 `$dataActors` 等库表字段（现有 `FIELD_BUCKETS`）作 src，zh 取本作 `store` lookup。规则与上表相同，不读其它游戏的 shared 名。

### 2.2 模块

纯约定放 `lib/translate/name-glossary.ts`（或扩 `glossary-mask.ts`，禁止再堆 CLI `services/translate/lib/glossary.ts`）：

```ts
type NameEntry = { src: string; zh: string; category?: string }
type NameSpan = { start: number; end: number; src: string; zh: string }

expandNameVariants(entry, toLang): NameEntry[]   // Rei / Rei's
findNameSpans(text, entries): NameSpan[]         // 跳过 SENTENCE_TOKEN_SOURCE / 控制码区间
stitchNameLocks(src, spans, gapZh): string       // 原文空隙保留；只替换 lock 与已译 gap
```

服务端装表：`services/translate/name-glossary-game.ts`，挂 `getGameCacheContext` 的 stamp，文件变则重建。插件：`store.put` / 热更新后 `rebuild`。

## 3. 锁点与拼接

对已剥 `choice-meta` 的正文：

1. 整句 / planner `full` / enrich 精确或模板命中 → 原样回，**不**解锁重译（`force` 除外：跳过 cache 后仍锁专名）。
2. miss 后 `findNameSpans`。无 span → 维持现状，全文进 protect + 引擎。
3. 有 span → 互补区间为 gap。仅控制码 / `!shouldTranslate` 的 gap 作字面量；其余 gap 走现有引擎（含 fallback、敏感词、容量）。
4. `stitchNameLocks`；整句按调用方原标记写回（新译 `live:<engine>`，存量见 §5）。名称行权威不动。
5. 整句只由 lock 组成（如单行 `Rei` / `Rei's`）→ 本地拼接，不发引擎。

`Rei's mother.` → lock `[0,5) Rei's=蕾的` + gap `[5,13) mother.` → 引擎只见 ` mother.` → `蕾的母亲`。

禁止：把 `__NAME__` 丢给引擎；给任一引擎加「保留 Rei=蕾」prompt；在译文侧全局换「丽」。

拼接以原文偏移为准。引擎丢掉的 gap 首尾空白用原文空隙补，不信引擎空格。

## 4. 接线（适用过程只改包装层）

### 4.1 服务端 `liveTranslateTexts`

插在现有整句 cache / numeric / 控制码 lookup **miss** 之后、`protectSentenceForTranslate` 之前。`force` 跳过整句 cache 后仍走锁 span，避免强制重译再次漂名。

gap 递归 `liveTranslateTexts`：`trackLiveActivity: false`、沿用 engines；**不要**对空隙碎片写独立 cache 权威（` mother.` 不是可复用句）。与 planner 对独立句 gap 的 `force` 不同：这里默认 `persist: false`，只把 stitch 后的整句按原调用 `persist` 写入。

一次改动覆盖：默认 `/api/translate`、seed / `fillMissingFromSeed`、sources、`mode: realtime`。`short-entities` 整词名称等于无 gap，不拦「优化名称」改名。

### 4.2 插件 `translator.translate()`

`enrich.resolve` / 局内 plan `full` 之后、插件现用的 `protectForTranslate` + 直连引擎之前同样 `findNameSpans`。Google / Bing / Ollama 在插件进程内；Apple / Bergamot / Agent 会打 `mode: apple|bergamot|ai` **只携带 gap**。因此：

- 局内 miss：**适用**，必须在插件再锁一次（服务端 live 改了也挡不住直连）。
- 控制台 `mode: apple|ai` 探活 / 试译：**不适用**，仍是裸全文。

`lookup-enrich` 模板继续回填已见过的句型；首次 miss 不得只靠模板。

### 4.3 明确不接线

`mode: lookup`、`save-item`、导入 / 语言包、`apply-terms`、RGSS 写回 / 预览、`benchmarkLocalModel`、CLI `lib/main.ts`（除非该管线仍在用，另开任务扩拉丁名）。

## 5. 存量 apply-names

不是翻译引擎，是洗库。挂 `mode: optimize`，与 short-entities 同门闩：`assertOptimizeMayDispatch`，实时对白让路。`scan-names` 只读预览，不被门闩挡住。

**主路径（不依赖认出「丽」）：** 默认按当前选中名称或名称筛选，禁止无预览扫全库对白。本作 records 原文含该名或其变体 → 跳过 `manual` / `import*` / `reset` → 按 §3 lock + 只译 gap（可命中短句缓存，默认可发译但不 `force` 整句）→ stitch → 与当前 zh 相同则 skip，不同则进预览。预览须展示整句新旧译文：gap 重译可能改写专名以外的用词。已是 `live:optimize*` 但 stitch 仍不同就可改。

**快路径：** 名称行刚从 `oldZh` 改成 `newZh` 时，对含该 src 的 live 句做片段替换（单词边界 / 已展开变体）。对不齐 → `needsReview`，不盲写。

写回 `live:optimize:names`（秩 2，与现有 `live:optimize*` 同档）。shared `writeMany` 拒则整键 skip，避免只写 ndjson。

禁止：译文全局「丽→蕾」；为不一致 `force` 重跑全库对白。

## 6. API 与 UI

| 面                               | 行为                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- |
| `mode: optimize` + `scan-names`  | 预览 `{ src, oldZh, newZh, via }`（via = stitch / rename / review）与计数 |
| `mode: optimize` + `apply-names` | 确认后写回；`limit` / `signal`；门闩失败返回 paused                       |
| 列表                             | 次要动作「同步到句子」；名称筛选时可强调。先 scan 再确认。不新开 Tab      |
| 翻译库「优化」                   | 不改文案、不复用                                                          |
| i18n                             | `translate.syncNames*`，与 `optimizeNames*` 分开                          |

错误码把 `scan-names` / `apply-names` 列入 `OPTIMIZE_ACTION` 合法 action；秩跳过进 stats。

## 7. 测试

1. 变体：`Rei` / `Rei's` / `Rei’s` 入表；`Reign`、词中子串不入 span。
2. live：cache miss 时引擎入参不含 `Rei`；stitch 为「蕾的母亲」；名称行仍是原引擎标记。
3. cache hit「丽的母亲」不经 lock 改写；只出现在 scan-names 预览。
4. 插件：plan miss + 直连 google/apple 时只发送 gap。
5. 秩：apply-names 不盖 manual/import；可升普通 `live:*`。
6. 门闩：realtime 进行中 apply-names 不新派发。
7. `mode: ai` 直测全文仍可把 Rei 译成丽。

## 8. 落点与开工顺序

1. `lib/translate/name-glossary.ts` + 单测（变体 / 边界 / stitch）。
2. `name-glossary-game.ts` 接入 `getGameCacheContext`。
3. `live-translate.ts` miss 后锁 span。
4. `plugins/mv/src/translator/runtime/translator.ts` 同样锁；enrich 不改主序。
5. `optimize-service`（或旁路 `name-sync-service.ts`）scan/apply + route。
6. 列表次要按钮 + i18n。

手写源目标 ≤600 行；`live-translate.ts` / `translator.ts` 若超限按 `$chaya-structure` 把 lock 调用抽薄包装，不把找 span 逻辑内联进文件。

## 9. 非目标

SQLite schema、planner 词切分、`__NAME__` 占位符主路径、引擎 prompt、CLI 拉丁名、全库 polish、跨游戏 shared 专名、非 zh 所有格、日文敬称（さん / くん）自动折叠。
