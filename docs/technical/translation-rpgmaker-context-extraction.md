# RPG Maker 文本来源、说话人与剧情上下文抽取技术设计

- 日期：2026-10-27
- 状态：草案（待实现）
- 对应需求：[RPG Maker 上下文抽取需求文档](../translation-rpgmaker-context-extraction.md)
- 关联模块：`services/extract/lib/`、`services/translate/`、`lib/translate/`
- 有效范围：RPG Maker 系列（MZ / MV / VX Ace / VX / XP）的事件与对话静态抽取管线、数据结构扩展及翻译提示词注入。

本文指令与参数示例以 MV / MZ 为基线，其他引擎须经适配和样例验证后声明支持。以下为拟定设计，不表示对应类型、元数据传递与 Prompt 接线已经实现。

---

## 1. 架构总览与落点规划

依照项目无 UI 算法与抽取管线解耦原则，上下文抽取分为**索引预构建**、**无 I/O 上下文解析**、**事件流状态机遍历**与**Prompt 上下文注入**四个层次：

```
services/extract/lib/
├── database.ts                   # 预构建 ActorFaceIndex、ActorIdMap、MapNameIndex
├── dialogue-context.ts           # [新增] 核心无 I/O 算法：P1~P8 识别、黑名单过滤、气泡音量解析
├── dialogue.ts                   # 增强事件指令遍历：探测 101/213/250/102，构建轮次窗口
└── extract-items.ts              # 消费上下文元数据，纯化待译正文，输出 DialogueContextMetadata

lib/translate/
└── engine-http.ts                # 增强 buildTranslateSystemPrompt，结构化注入剧情与情绪上下文
```

---

## 2. 数据库反查索引预构建

在抽取任务启动阶段，由 `services/extract/lib/database.ts` 一次性构建三张内存反查表：

### 2.1 角色反查索引（`ActorIndex`）

从 `data/Actors.json`（或 RGSS 的 `Actors.rvdata2`）提取并构建：

```ts
export interface ActorIndex {
  /** 精确反查：${faceName}_${faceIndex} -> actor.name (如 "Actor1_0" -> "ハロルド") */
  faceExact: Map<string, string>
  /** 容差反查：若某个 faceName 全局唯一归属某角色，记录 faceName -> actor.name */
  faceStem: Map<string, string>
  /** 控制码反查：actorId (1-based) -> actor.name (用于 \\N[n] 展开) */
  idMap: Map<number, string>
  /** 名字集合：用于快速判断文本首部的词是否为已知角色名 */
  knownNames: Set<string>
}
```

**构建逻辑与容差策略**：

1. 遍历 `Actors.json`，若 `actor.name` 非空：
   - 写入 `idMap.set(actor.id, actor.name)`；
   - 将 `actor.name` 记入 `knownNames`。
   - 另在存在 `faceName` 时写入 `faceExact`；同一头像组合对应多个角色时标记歧义，不以最后写入者覆盖。没有头像的角色仍可通过 ID 与姓名匹配。
2. 统计所有角色的 `faceName` 使用频次；若某 `faceName`（如 `Alice`）只被该角色独占使用，写入 `faceStem.set(actor.faceName, actor.name)`。后续即使剧情中遇到 `faceIndex = 3`（表情差分），仍能稳健命中角色名。

### 2.2 地图场景索引（`MapNameIndex`）

遍历 `MapInfos.json` 及各 `MapXXX.json`：

- 优先读取玩家屏幕可见的 `displayName`（如 `王都地下牢`、`静謐の教会`）；
- 若无 `displayName`，降级读取工程名 `name`（如 `地下牢1F`）；
- 存储为 `Map<number, string>`，供各事件块按 `mapId` 快速索引。

---

## 3. 说话人识别流水线算法实现（`dialogue-context.ts`）

### 3.1 识别流水线（P1~P8）算法与防误判过滤

核心函数 `resolveSpeaker(params)` 按优先级流水线执行：

```ts
export interface ResolveSpeakerParams {
  rawLines: string[]
  faceName?: string
  faceIndex?: number
  engineSpeaker?: string // MZ p[4]
  precedingSpeaker?: string // 注释/插件指令暂存
  eventName?: string // 地图事件名
  troopEnemyName?: string // 战斗敌群名
  actorIndex: ActorIndex
}

export interface SpeakerResult {
  speaker?: string
  speakerSource?: 'markup' | 'plugin_code' | 'engine_param' | 'control_code' | 'face_actor_map' | 'face_fallback' | 'preceding_command' | 'troop_enemy' | 'event_name'
  cleanedLines: string[] // 剥离姓名外壳后的正文行
}
```

#### P1: 首部定界符匹配与 Anti-Spoofing 过滤

- 正则匹配首行首部：
  - 中文/日文角括号：`/^【(?<name>[^】\n]{1,16})】/`
  - 方括号：`/^[［\[](?<name>[^］\]\n]{1,16})[］\]]/`
  - 冒号分割：`/^(?<name>[\u4e00-\u9fa5\u3040-\u30ffA-Za-z0-9_]{1,12})[：:]/`
- **黑名单阻断（Anti-Spoofing）**：
  若命中内容匹配以下正则，坚决拒绝认定为 `speaker`，作为 `sceneHint` 或保留原样：
  ```ts
  const SPOOFING_REGEX =
    /(?:ヒント|操作|システム|Tips|Notice|Tutorial|ルール|ヘルプ|注意|警告|案内|入手|獲得|消費|装備|購入|売却|アイテム|スキル|クエスト|ミッション|回想|過去|現在|翌日|数日後|数時間後|数年後|夢|記憶|場面|視点|第[0-9一二三四五六七八九十]+[章幕節話]|Chapter|Prologue|Epilogue|Ending|Opening|Stage|Area|Map)/i
  ```
- 先对候选名做 Unicode NFKC 规范化再过滤，覆盖 `【第１章】` 等全角数字；该规范化结果只用于判定，不改写原始正文。
- **内联控制码清洗**：
  若提取内容含 `\C[n]`、`\I[n]` 等，用正则 `/\\[A-Za-z]+\[\d+\]/g` 剥离，仅留纯文字。
- **正文纯化动作**：
  若定界符独占第一行（即第一行去除定界符后无其他正文），直接移除该行；若定界符位于首行行首且后面紧跟台词，将定界符从首行中裁切，保留后续台词。

#### P2: 插件名字框控制码

- 匹配正则：`/\\(?:n[crd]?|name|cname|fn)<(?<name>[^>]+)>/i`；
- 命中后提取 `name`，并将控制码从原文中剔除（或转为格式保护标记），避免模型翻译或丢弃该插件代码。

#### P3: 原生引擎参数

- 若存在 `engineSpeaker`（即 MZ `parameters[4]`），清洗两端空白后直接采用。

#### P4: 动态控制码展开

- 仅在已识别的姓名区域解析 `\\N\[(?<id>\d+)\]` 或 `\\P\[(?<pos>\d+)\]`，正文中提到某角色不能直接确定说话人；
- `\N[n]` 静态解析查 `actorIndex.idMap` 得到默认名，运行时优先使用当前角色名；
- `\P[n]` 必须通过运行时或可信快照的队伍顺序解析，不能用 `idMap.get(n)` 替代；静态队伍未知时保留控制码并标记未解析。
- P1–P3 提取的姓名区域也经过本步骤解析，不能因先命中外壳就跳过内部控制码。

#### P5: 头像反查角色表

- 若 `faceName` 存在且非空：
  1. 精确查 `actorIndex.faceExact.get(`${faceName}_${faceIndex}`)`；
  2. 若未命中，降级查单图容差 `actorIndex.faceStem.get(faceName)`；
  3. 若仍未命中，降级提取去除数字前缀的文件名（如 `Actor1`），来源标记为 `face_fallback`。

#### P6 ~ P8: 指令暂存、敌群怪物与事件名

- P6：消费前序指令暂存的 `precedingSpeaker`；
- P7：若处于战斗事件且包含单一 Boss 敌群，提取怪物名；
- P8：过滤掉 `isEngineEventId(eventName)` 后的 NPC 名称（如 `村長`、`商人`）。

---

## 4. 事件流上下文状态机（`dialogue.ts`）

在遍历 `page.list` 事件指令时，维护一个局部状态机：

```ts
interface EventScanState {
  lastSpeaker?: string
  lastFace?: string
  precedingSpeaker?: string // 由 108/408/356 产生
  recentBalloon?: { iconId: number; distance: number } // MV 指令 213 产生的气泡
  recentSe?: { name: string; distance: number } // 250 产生的音效
  turnCounter: number
}
```

### 4.1 窗口模式与引号解析（`speechMode`）

- 指令 101 的 `parameters[2]`（Background）：
  - `0` (Window) -> `spoken`（当面对话）
  - `1` (Dim) -> `monologue`（内心独白）
  - `2` (Transparent) -> `narration`（场景旁白）
- 检查文本首尾引号：
  - `「……」` -> 强化为 `dialogue`
  - `（……）` / `(……)` -> 重载为 `monologue`（心声/低语）
  - `『……』` -> 记录 `quoteType: 'double_corner'`，仅作为传音、回忆或引用的线索，不输出契约外的 `speechMode`

### 4.2 演出与情绪探针

1. **气泡（MV Code 213）**：当遇到指令 213 时，记录 `recentBalloon = { iconId: p[1], distance: 0 }`。随后每过一条指令 `distance++`；若在 3 条指令内遇到 101 对白，将其转化为 `emotionHint`（如 `1` -> `surprise`，`4` -> `affection`，`5` -> `anger`），消费后清空。MV 的 212 是动画指令，不进入此探针。
2. **音效（Code 250）**：若 3 条指令内播放了含 `scream`、`damage`、`collapse`、`pain` 关键字的 SE，标记 `hasPainSound = true`。
3. **音量控制码**：分析文本中的 `\{`（字体放大次数）和 `\}`（字体缩小次数）：
   - `放大数 - 缩小数 >= 2` -> `volumeHint: "shout"`
   - `缩小数 - 放大数 >= 2` -> `volumeHint: "whisper"`

### 4.3 对话轮次滑动窗口（Turn Context）

在同一个事件遍历中，将产出的连续对白块组织为双向链表：

- 对白块包含 `turnIndex`（从 0 自增）；
- 在 flush 整批对白时，为每个对白块回填：
  - `prevSpeaker = prevBlock.speaker`
  - `prevText = prevBlock.lines[0]`（取上一轮摘要）
  - `nextSpeaker = nextBlock.speaker`

### 4.4 选项分支（Code 102）上下文继承

当解析到 Code 102 时：

- 从紧邻的前一个对白块继承 `promptSpeaker` 和 `promptText`；
- 生成选项条目时，将其挂载到选项的元数据中，使选项在翻译时能获取上一句提问上下文。

---

## 5. 数据契约与类型定义

在 `lib/translate/resource-types.ts` 或独立类型模块中固化：

```ts
export interface DialogueContextMetadata {
  /** 规范化说话人 */
  speaker?: string
  /** 原始剥离后的正文行 */
  cleanedLines?: string[]
  /** 来源判定途径 */
  speakerSource?: 'markup' | 'plugin_code' | 'engine_param' | 'control_code' | 'face_actor_map' | 'face_fallback' | 'preceding_command' | 'troop_enemy' | 'event_name'

  /** 表达形态 */
  speechMode: 'spoken' | 'monologue' | 'narration' | 'scrolling'
  /** 引号类型 */
  quoteType?: 'corner' | 'round' | 'double_corner' | 'none'

  /** 演出暗示 */
  emotionHint?: 'surprise' | 'question' | 'joy' | 'affection' | 'anger' | 'sweat' | 'silence' | 'idea' | 'sleepy'
  volumeHint?: 'shout' | 'whisper' | 'normal'
  rhythmHint?: 'hesitant' | 'normal'
  hasPainSound?: boolean

  /** 选项提问上下文 */
  promptSpeaker?: string
  promptText?: string

  /** 地理场景与多轮 */
  scene?: string
  mapId?: number
  turnIndex?: number
  prevSpeaker?: string
  prevText?: string
}
```

---

## 6. 翻译 Prompt 注入模板增强

在 `lib/translate/engine-http.ts` 中增强 `buildTranslateSystemPrompt`。以下只展示新增元数据的提示组装；实施时扩展既有 `category / speaker / context` 输入，保留原分类提示和无新增元数据时的行为，不能直接用示例替换现有函数：

```ts
export function buildTranslateSystemPrompt(ctx?: DialogueContextMetadata): string {
  if (!ctx) return OLLAMA_TRANSLATE_SYSTEM

  const hints: string[] = []

  // 1. 说话人与口吻
  if (ctx.speaker) {
    hints.push(`【说话人】：${ctx.speaker}（请结合该角色性格采用恰当的第一人称与说话口吻）`)
  }

  // 2. 表达形态
  if (ctx.speechMode === 'monologue') {
    hints.push(`【表达方式】：内心独白 / 心声思考（角色心中所想，未当面对他人说出，请使用内敛、自省语气）`)
  } else if (ctx.speechMode === 'narration') {
    hints.push(`【表达方式】：场景旁白 / 剧情叙事（非角色直接对话，请使用客观书面语）`)
  }

  // 3. 情绪与发声
  const emotions: string[] = []
  if (ctx.emotionHint) {
    const emotionMap: Record<string, string> = {
      surprise: '震惊/警觉',
      question: '困惑/疑问',
      joy: '欢快/高兴',
      affection: '娇羞/好感',
      anger: '愤怒/粗鲁',
      sweat: '尴尬/无奈',
      silence: '沉默/沉思',
      idea: '灵光一闪',
      sleepy: '困倦/含糊',
    }
    emotions.push(emotionMap[ctx.emotionHint] || ctx.emotionHint)
  }
  if (ctx.volumeHint === 'shout') emotions.push('大声呐喊')
  if (ctx.volumeHint === 'whisper') emotions.push('轻声低语')
  if (ctx.hasPainSound) emotions.push('负伤/痛苦')
  if (emotions.length) {
    hints.push(`【语气/情绪】：${emotions.join('、')}`)
  }

  // 4. 地理场景
  if (ctx.scene) {
    hints.push(`【当前场景】：${ctx.scene}`)
  }

  // 5. 前后对话上下文（代词消歧）
  if (ctx.prevSpeaker && ctx.prevText) {
    hints.push(`【上一轮对话】：[${ctx.prevSpeaker}]「${ctx.prevText}」`)
  }
  if (ctx.promptSpeaker && ctx.promptText) {
    hints.push(`【选项所针对的提问】：[${ctx.promptSpeaker}]「${ctx.promptText}」`)
  }

  if (!hints.length) return OLLAMA_TRANSLATE_SYSTEM

  return `${OLLAMA_TRANSLATE_SYSTEM}\n\n[剧情上下文提示]\n${hints.join('\n')}`
}
```

---

## 7. 性能约束与实现边界

1. **单遍扫描（Single-pass）与零多余 I/O**：
   - 上下文状态机与原事件遍历合并，在同一循环中完成，时间复杂度保持 O(N)；
   - 数据库反查索引预加载仅在启动时执行一次，总内存占用小于 2MB。
2. **正文保护边界**：
   - 剥离定界符与姓名时，绝对不修改原数据文件中的原始脚本；仅在向抽取输出（`record()`）与送译时提供清洗后的版本；
   - 若作者故意使用 `【アイテム入手】` 等系统提示，经黑名单过滤后必须完整保留在正文中，不得丢词。
3. **M1 与 M2 衔接边界**：
   - 本模块只负责**特征抽取与结构化解析**，不调用外部分类模型，不产生网络开销；
   - 输出的元数据结构严格对齐 M2 需求文档 §3 的 7 维打标 Schema。

---

## 8. 测试策略与验收用例

在 `__tests__/services/extract/dialogue-context.spec.ts` 中实现覆盖以下场景的单元测试：

1. **定界符与防伪测试**：
   - `【アリス】「ありがとう」` -> `speaker: "アリス"`, `cleaned: "「ありがとう」"`；
   - `【\C[2]勇者\C[0]】` -> `speaker: "勇者"`（控制码清洗）；
   - `【アイテム入手】薬草を手に入れた` -> `speaker: undefined`（黑名单正确拦截）；
   - `【第１章】旅立ち` -> `speaker: undefined`。
2. **插件控制码测试**：
   - `\n<Harold>おはよう` -> `speaker: "Harold"`, `cleaned: "おはよう"`；
   - `\cname<Rei>待って！` -> `speaker: "Rei"`, `cleaned: "待って！"`。
3. **头像反查与表情差分容差测试**：
   - 给定 `Actors.json` 包含 `Harold`（`Actor1, 0`）与 `Alice`（`Alice_face, 0`）：
   - `(Actor1, 0)` -> 命中 `Harold`；
   - `(Alice_face, 2)`（表情差分）-> 命中 `Alice`。
4. **窗口模式与括号测试**：
   - Background = 1 -> `speechMode: "monologue"`；
   - Background = 0 但带 `（……）` -> `speechMode: "monologue"`；
   - Background = 2 -> `speechMode: "narration"`。
5. **气泡与多轮滑动窗口测试**：
   - MV 213 (Icon 5) 后 3 条指令内出现 101 -> `emotionHint: "anger"`；212 不产生气泡情绪；
   - Turn 0 (勇者) 与 Turn 1 (村长) -> Turn 1 携带 `prevSpeaker: "勇者"`。
