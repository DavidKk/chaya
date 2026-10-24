# 翻译专名句内一致性需求

- 日期：2026-10-25
- 状态：草案；未实现。覆盖 [质量优化](translation-optimization.md) 一期未做的「句子路径锁定名称行当前专名」。
- 关联文档：[质量优化](translation-optimization.md) §2.2 / §6；[调度基线](translation-scheduling.md)；[游玩翻译](rgss-play-realtime-translation.md)
- 关联技术方案：[专名一致性设计](technical/translation-name-consistency.md)（人名表 §2，锁点 §3，接线 §4，存量 §5）
- 按需定位：**适用 / 不适用 §3**；人名表 §4；新译锁 span §5；存量回填 §6；验收 §8。

## 1. 背景与问题

列表把角色名 `Rei` 译成「蕾」后，对白 `Rei's mother.` 仍可能被译成「丽的母亲」。

1. 「优化名称」只改 `actor` / 物品等短专名，不进 `dialogue` / `story` / 描述句。
2. 现有 glossary 只收日文库名；拉丁专名进不了 mask。
3. 句子规划器按标点切整句，不会把句内 `Rei` / `Rei's` 抠成可复用片段。
4. 控制台 live 与插件局内 miss 在整句 cache miss 后把全文交给引擎；Bing / Google / Apple / Bergamot / Agent / Ollama 都可能把同一专名音译成不同汉字。

专名对错比长句润色更伤观感。本需求只锁**名称行当前译文**，不重跑全库精翻。

## 2. 目标与原则

1. 人名表跟列表走：`extract-items` 名称类 ⋈ 该行当前权威译文（含普通 `live:*`）。不必先手改或跑「优化名称」。
2. 新译在发引擎前锁定原文 span，只把剩余 gap 交给任意引擎；引擎品牌无差别。`force` 只跳过 cache，仍锁专名。
3. 已有脏句按原文扫描、预览后回填，不在译文侧全局替换「丽」。
4. 人工定稿、导入、整句 cache hit、控制台裸引擎探活不参与锁定，也不得被专名表覆盖。
5. 产品入口不新开顶栏 Tab；列表定稿或已有名称译文后可提供「同步到句子」，与「优化名称」文案区分。

**变体（建表时展开，引擎内不猜）：**

| 原文变体          | 锁定译文 | 说明                                     |
| ----------------- | -------- | ---------------------------------------- |
| `Rei`             | 蕾       | 拉丁名单词边界，避免 `Reign`             |
| `Rei's` / `Rei’s` | 蕾的     | 所有格单独成变体；不要把 `'s` 再交给引擎 |

一期实现可装入全部名称类；验收用例以 `actor` 为准（`actor_nickname` 单行且短时可入）。CJK 名按最长精确匹配，不用拉丁词边界。

## 3. 适用与不适用

按「谁在发译、谁已经定稿」划分，不按引擎品牌划分。锁点只加在发译包装层：整句 cache miss 之后、现有 protect / 引擎派发之前。

### 3.1 适用：会把原文交给引擎的过程

这些路径生成新的 `live:*`。不锁，`Rei's mother.` 就会整句进引擎。Bing / Google / Apple / Bergamot / Agent / Ollama **全部适用**——它们都可能把 `Rei` 译成「丽」。不要给任一引擎加「请保留 Rei=蕾」或 `__NAME__` 占位符当主方案。

| 过程                  | 现行入口                                                                                                | 锁点                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 控制台缺词补译        | 默认 `/api/translate` → `liveTranslateTexts`                                                            | 服务端 live                                              |
| Seed / 原文作业       | `mode: seed` / `job` → `fillMissingFromSeed` → live                                                     | 同上                                                     |
| Sources 字符串包      | `mode: sources` → `sources-job` → live                                                                  | 同上                                                     |
| 游玩实时对白          | `mode: realtime` → `translateDialogue` → live（现固定 ollama）                                          | 同上                                                     |
| 插件局内 miss         | `plugins/mv` `translator.translate()` 直连 Google/Bing/Ollama，或回打 `mode: apple` / `bergamot` / `ai` | **插件侧必须再锁一次**；回打时只许带 gap                 |
| 优化 L2 / 二期 polish | `short-entities` / `batch-optimize` → live                                                              | 句子级适用；短名整词无 gap，不拦「优化名称」改名         |
| CLI 离线管线          | `services/translate/lib/main.ts` 已有 glossary mask                                                     | 仅当仍使用该管线时另开任务扩拉丁名；控制台主路径不依赖它 |

服务端改 `liveTranslateTexts` 一次，即可覆盖上表除插件直连与 CLI 以外的发译入口。插件不经 live 的直连必须自己锁；不能指望服务端改完局内就好。

### 3.2 不适用：不发译，或权威已经高于专名表

| 过程                                                                     | 原因                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 整句 / 分段 cache hit（`cache:local` / `cache:remote` / planner `full`） | 不再发译。库里已是「丽的母亲」会原样回；存量走 §6                            |
| 插件 `enrich.resolve`（精确命中、尾缀数字、已有模板）                    | 只查表。没有模板就不会拼出「蕾的母亲」                                       |
| `mode: lookup`                                                           | 只读 shared，零推理                                                          |
| 列表手改 / `save-item`                                                   | 写 `manual`，秩最高。人名定稿走这里，但不会自动传播到其它句                  |
| 导入 / 语言包回写（`import*` / `game:locales`）                          | 外来权威，禁止用专名表覆盖。导入的**名称行**仍可入人名表                     |
| `apply-terms` / `builtin:terms`                                          | 只纠 Save→节省 等系统词，不管角色名                                          |
| 「优化名称」`short-entities` 对短名本身                                  | 只改名称行，不进对白；与本需求入口分离                                       |
| 控制台 `mode: apple` / `bergamot` / `ai` 直测                            | 裸引擎探活 / 试译，全文绕过 live。**不同于**插件 miss 只把 gap 打进这些 mode |
| `benchmarkLocalModel`                                                    | 固定日文样句，不读不作缓存                                                   |
| RGSS 写回 / 预览                                                         | 只把已有译文打进 Data，不翻译                                                |
| 译文侧全局「丽 → 蕾」                                                    | 「丽」是常用字，禁止盲替换                                                   |
| 为专名不一致 `force` 重跑全库对白                                        | 成本高且会踩 manual / import                                                 |

人工定稿和导入不但不该被锁名覆盖，名称行若是它们写的，人名表还要以它们为准。

### 3.3 半适用：存量回填

「同步到句子 / apply-names」洗已入库机翻。主路径按原文重新 lock，**只把未锁定 gap 交给 live**（可命中短句缓存，默认可发译但不 `force` 整句）。因此它不是「零推理」，必须预览：除专名外，gap 新译文可能改写原句其它用词。

| 可改                                                                                                                    | 不改                                                | 只预览                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| 任意引擎留下的 `live:*`（含 google / bing / apple / bergamot / agent / ollama）；已是 `live:optimize*` 但 stitch 仍不同 | `manual`、`import*`、`reset`；stitch 与当前 zh 相同 | 快路径片段替换对不齐、语序对不上的句子，标 `needsReview` |

## 4. 人名表

- 数据源必须是 `extract-items`（带 `meta.category`）⋈ 本作名称行当前权威；禁止只扫无 category 的 ndjson / shared。
- **入表不要求** `manual` / `live:optimize*`。列表里 `Rei → 蕾`（普通 live）即可锁新句。
- 拉丁名、日文名都收；现有 `loadGlossaryEntries()` 的 `hasJapanese` 不得作为本需求的收词条件。最短 2 字；单字母拉丁名不锁。
- 拉丁名按单词边界匹配，CJK 名最长精确匹配；更长名优先，避免短名吞掉长名。撇号所有格用显式变体，不用 `\b` 去切 `Rei's`。
- 共享约定放 `lib/translate/`（新 `name-glossary.ts` 或扩 `glossary-mask.ts`）。不要继续只堆在 CLI 专用的 `services/translate/lib/glossary.ts`。

## 5. 新译：锁定 span，只译 gap

```text
Rei's mother.
  ├─ lock  [0,5) Rei's   → 蕾的
  └─ gap   [5,13) mother. → 引擎 → 母亲
stitch → 蕾的母亲
```

1. 整句 cache hit 仍直接回，不解锁重译（`force` 除外：跳过 cache 后仍锁专名）。
2. miss 后用 §4 表在原文上标半开区间 `[start,end)`。这是发译前的额外 lock，**不是** planner 的 `SentenceMatch`，也不改分句规则。
3. 只把 gap 文本发给当前启用引擎（沿用既有 fallback / 敏感词 / 容量门闩）。gap 子调用不把「空隙 + 残余」写成独立 cache 权威。
4. 按原文偏移拼接后写回整句 `live:*`；名称行权威不变。
5. 控制码、choice-meta、动态模板仍先走各自现有 protect（live：`protectSentenceForTranslate`；插件：`protectForTranslate`）；专名锁不得拆开控制码。
6. `force` 跳过整句 cache 后仍走 2–5，避免强制重译再次漂名。

插件局内 lookup 可继续用模板回填**已见过**的句型；**首次** miss 必须走锁 span，不能只靠 `translateByGlossaryTemplate`。

## 6. 存量：按原文传播

列表已有 `Rei → 蕾`（或刚改名）后，提供次要动作「同步到句子」（先 scan 预览，确认再写）。默认按当前选中名称或名称筛选，禁止无预览扫全库对白。

1. 扫本作 records：原文含该名或其变体。
2. 跳过 §3.3 不改集合。
3. **主路径**：重新 lock + 只译 gap + stitch；不依赖认出「丽」。与当前 zh 相同则 skip。
4. **快路径**（可选）：名称行刚从 `oldZh` 改成 `newZh` 时做片段替换；对不齐标 `needsReview`。
5. 写回 `live:optimize:names`（或同档 `live:optimize*`），秩 ≥ 普通 `live:*`，不可盖 `manual` / `import*`。
6. 运行中让路实时对白；与「优化名称」同队列时短名称作业仍可优先。scan 预览不被门闩挡住。

## 7. 与现有能力的边界

| 能力                    | 关系                                             |
| ----------------------- | ------------------------------------------------ |
| 「优化名称」            | 继续只处理短专名行；本需求处理句内传播与新译锁定 |
| `apply-terms`           | 系统菜单词；不并入人名词表                       |
| 翻译库「优化」          | 分段映射确认，文案不得改成「同步到句子」         |
| 句子 planner / 整句回退 | 不改成词切分器；专名 lock 不是新的标点规则       |
| 语言包 / 导入           | 句内不覆盖；导入的名称行可入表                   |

优先级沿用质量优化：**人工定稿 > 实时对白 / 游玩 > seed / sources 补译 > 专名锁定 / 同步到句子 > 全库润色**。

## 8. 一期范围与验收

**做：**

1. 本作人名表 + 拉丁名 + `'s` / `’s` 变体；名称行当前权威即可入表。
2. `liveTranslateTexts` 锁 span；seed / 列表补译 / sources / realtime 随之生效。
3. 插件 `translator.translate()` 引擎派发前同样锁定。
4. 列表「同步到句子」scan → 预览 → 确认写回；跳过 manual / import。

**不做：** 控制台裸引擎直测、lookup、RGSS 写回、译文全局替换、全库 `force` 重译、新顶栏 Tab、为引擎写专名 prompt、改 CLI `hasJapanese` 管线（除非该管线仍在用并另开任务）。

**验收：**

1. 列表已有 `Rei → 蕾` 后，新译 `Rei's mother.` 得到「蕾的母亲」（专名位置为「蕾」，不得把 Rei 译成「丽」；句中其它「丽」不在此列）；任意启用引擎锁到同一专名。`force` 重译该句仍锁「蕾」。
2. `Reign` / 无边界子串不被替换。
3. 手改过的句子、导入句、cache hit 旧句不因锁定被静默改写；旧句只出现在「同步到句子」预览里。
4. 控制台 `mode: apple` / `ai` 直测仍是裸全文，可继续把 Rei 译成丽。
5. 实时对白进行中，apply-names 停派发、让配额。
