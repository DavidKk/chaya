# 翻译专名句内一致性技术设计

- 日期：2026-10-25
- 有效性：现行；实现进度：live / 插件锁定、RGSS 名称来源、预览快照写回已接入并通过相关回归；实际游戏存量应用仍需用户确认。
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

目标语言一期仅简体中文 `zh`（兼容 `ch` / `zh-cn` / `zh-hans`）；其它目标语言（含繁体）不启用本作简体译名锁定及存量同步。CJK 名最长精确匹配，不用拉丁词边界。

## 2. 人名表

### 2.1 收词

| 项     | 约定                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源     | 与 `extract-items` 一致的字段分类，`meta.category ∈ {actor, actor_nickname, item, weapon, armor, skill, enemy, state, map}` ⋈ 本作 records / lookup |
| 权威   | **名称行当前权威译文**（与列表展示一致），不限 `manual` / `live:optimize*`                                                                          |
| 不入表 | zh 空、zh===src、`reset` 作废键、短于 2 字、单字母拉丁名、非名称类、无 category 的裸 ndjson                                                         |
| 匹配   | 更长 `src` 优先；拉丁名单词边界；撇号所有格单独成变体，不用 `\b` 切 `Rei's`                                                                         |
| 变体   | 原词；`to=zh` 时 ASCII `'s` / `’s` → 译文+「的」（译文已以「的」结尾则不加）                                                                        |

列表把 `Rei` 机翻成「蕾」即可入表并锁句子；不必先手改或跑「优化名称」。名称行被 `manual` / `import*` / `live:optimize*` 定稿后，只更新表，不改写该名称行。

RGSS 服务端用 `items-worker` 的 `namesOnly` 模式，仅解析 Actors / Items / Weapons / Armors / Skills / Enemies / States / MapInfos 名称库，过滤非名称字段；`description` 与 `profile` 均归角色介绍。名称源按 Data 文件身份缓存，`loadGameNameEntries` 异步装表，reset 键排除。

RGSS 名称表与列表共用 `game-lookup.ts` 的解析规则：显式 `manual` / `import` / `import:*` / `live:optimize` / `live:optimize:*` 优先，其次为 Data 中已有译文，普通机器缓存仅补缺。因此 Data 中 `Rei=蕾` 不会被旧 `live:bing` 的「国王」覆盖；同步结果与人工修改在列表重读后可见，`savedZh` 同步更新为已保存值，不修改游戏 Data 文件。MV/MZ 保持既有 lookup 优先顺序。

基础名存在时，所有格复合标签（如 `Rei's Baby`）不作为整词入表，防止旧标签权威压住 `Rei's=蕾的`；其余多词姓名保留最长匹配。

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

服务端装表：`services/translate/name-glossary-game.ts`，挂本作 records stamp 与 Data 名称源签名，文件变则重建；并发首次装表复用名称源 worker Promise。插件：`store.put` / 热更新后 `rebuild`。

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

一次改动覆盖：默认 `/api/translate`、seed / `fillMissingFromSeed`、sources、`mode: realtime`。`short-entities` 显式传内部 `optimizeWholeName: true`，仅跳过完整名称对自身的锁定，让「优化名称」能改名；默认 `force` 仍锁名，复合标签仍锁其基础名。

### 4.2 插件 `translator.translate()`

`enrich.resolve` / 局内 plan `full` 之后、插件现用的 `protectForTranslate` + 直连引擎之前同样 `findNameSpans`。Google / Bing / Ollama 在插件进程内；Apple / Bergamot / Agent 会打 `mode: apple|bergamot|ai` **只携带 gap**。因此：

- 局内 miss：**适用**，必须在插件再锁一次（服务端 live 改了也挡不住直连）。
- 控制台 `mode: apple|ai` 探活 / 试译：**不适用**，仍是裸全文。

`lookup-enrich` 模板继续回填已见过的句型；首次 miss 不得只靠模板。

### 4.3 明确不接线

`mode: lookup`、`save-item`、导入 / 语言包、`apply-terms`、RGSS 写回 / 预览、`benchmarkLocalModel`、CLI `lib/main.ts`（除非该管线仍在用，另开任务扩拉丁名）。

## 5. 存量 apply-names

这是对已有机翻的显式回填。`scan-names` 先按当前选中名称扫描本作 records，跳过 `manual*` / `import*` / `reset` / `game:locales`，再 lock + 只译 gap（`persist:false`、`trackLiveActivity:false`、沿用 sourceLang）。每个 gap 派发前检查 `assertOptimizeMayDispatch`；暂停即返回 paused，不给出可写预览。

预览是完整最终译文，禁止以「蕾的 mother.」等混合文本代替。与当前 zh 一致则 skip；gap 失败则 `review`，保留旧译文且不写入。一次最多 80 条候选，API 上限 200，`hasMore` 表示尚有未处理条目；一期不提供译文字符串替换快路径。

服务端用随机 `previewId` 保存原文、完整新旧译文、原始 record 签名（id/revision/zh/engine）、选中名称表及 contentRoot。预览缓存最多 16 份、有效期 10 分钟，仅存进程内，服务重启后需重扫。

`apply-names` 必须带 `previewId`：校验游戏、有效期与词表，认领并消费快照，逐条比较当前 record 签名及保护级别后，写入**已预览**的 `newZh`，不再调用引擎。换游戏/改名/过期返回 paused；句子发生变化则跳过。写回 `live:optimize:names`（秩 2），shared `writeMany` 拒绝则整键 skip；仅 accepted 以 `{ s, t, engine, at }` 事件回填本作 ndjson，保留优化来源。重复或并发提交不能重放预览。完整名称本身不在存量同步中改写。apply 期间再次检查实时门闩，暂停后重新预览。

禁止译文全局「丽→蕾」、未经预览写入、为不一致 `force` 重跑全库对白。

## 6. API 与 UI

| 面                               | 行为                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `mode: optimize` + `scan-names`  | 异步生成完整 `{ src, oldZh, newZh, via }`（stitch / review）、计数与 `previewId`                |
| `mode: optimize` + `apply-names` | 凭 `previewId` 写入快照；`signal`；门闩或快照失效返回 paused                                    |
| 列表                             | 名称筛选下提供「同步到句子」，逐条展示完整新旧译文，确认后刷新 extract-items；`names:[]` 不派发 |
| 翻译库「优化」                   | 不改文案、不复用                                                                                |
| i18n                             | `translate.syncNames*`，与 `optimizeNames*` 分开                                                |

错误码把 `scan-names` / `apply-names` 列入 `OPTIMIZE_ACTION` 合法 action；秩跳过进 stats。

## 7. 测试

1. 变体：`Rei` / `Rei's` / `Rei’s` 入表；`Reign`、词中子串不入 span。
2. live：cache miss 时引擎入参不含 `Rei`；stitch 为「蕾的母亲」；名称行仍是原引擎标记。
3. cache hit「丽的母亲」不经 lock 改写；只出现在 scan-names 预览。
4. 插件：plan miss + 直连 google/apple 时只发送 gap。
5. 秩：apply-names 不盖 manual/import；可升普通 `live:*`。
6. 门闩：realtime 进行中 scan 的 gap 不新派发，apply 不写回。
7. RGSS 集成：真实 Marshal 名称源 → live force → gap 引擎入参不含 Rei，stitch 含蕾；角色介绍不入表，复合标签不遮蔽基础名。
8. 快照：apply 不发引擎、拒绝改名/换游戏/过期、跳过扫描后改动的句子、不可重放；同步后列表重新读取数据。
9. `mode: ai` 直测全文仍可把 Rei 译成丽。
10. Data 的「蕾」高于普通机器缓存「国王」；同步与手动事件覆盖旧 Data 展示，刷新后 `savedZh` 一致，Data 字节不变。

2026-10-25 本机验证：当前绑定 RGSS 游戏的 `force:true, persist:false` 实际请求返回 `Rei's mother. → 蕾的妈妈`、`Rei's Baby → 蕾的宝宝`；`scan-names` 小批预览也使用「蕾」，未应用到真实游戏。自动化覆盖 RGSS Marshal 来源、Data/缓存冲突、预览应用与防重放、列表刷新，以及插件 Ollama 直连和 Apple 服务回调的 gap 派发；没有逐一实测全部外部引擎和游戏运行时。

## 8. 实现落点

1. `lib/translate/name-glossary.ts` + 单测（变体 / 边界 / stitch）。
2. `name-glossary-game.ts` 接入 `getGameCacheContext`。
3. `live-translate.ts` miss 后锁 span。
4. `plugins/mv/src/translator/runtime/translator.ts` 同样锁；enrich 不改主序。
5. `optimize-service`（或旁路 `name-sync-service.ts`）scan/apply + route。
6. 列表次要按钮 + i18n。

手写源目标 ≤600 行；`live-translate.ts` / `translator.ts` 若超限按 `$chaya-structure` 把 lock 调用抽薄包装，不把找 span 逻辑内联进文件。

## 9. 非目标

SQLite schema、planner 词切分、`__NAME__` 占位符主路径、引擎 prompt、CLI 拉丁名、全库 polish、跨游戏 shared 专名、非 zh 所有格、日文敬称（さん / くん）自动折叠。
