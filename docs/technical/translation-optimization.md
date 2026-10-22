# 翻译优化与闲时调度技术方案

- 日期：2026-10-23
- 状态：技术方案草案（待评审/已完成自审）
- 需求文档：[翻译优化（闲时/批量优化与游戏术语增强）需求文档](../translation-optimization.md)
- 关联设计：[翻译调度优化基线](../translation-scheduling.md)、[翻译管线规范](translation-pipeline.md)、[翻译缓存语义分段与优化技术方案](translation-cache-optimization.md)

## 1. 架构总览与核心设计

本方案围绕“机翻快速可用，术语一键纠偏，闲时深度优化，守秩安全写回”展开，形成如下分层架构：

```text
 ┌────────────────────────────────────────────────────────┐
 │                      待优化请求                         │
 │      (批量优化作业 / 闲时后台扫描 / 实时术语纠偏)       │
 └──────────────────────────┬─────────────────────────────┘
                            │
               [ 1. 游戏常用术语库 GameTerms ]
                - 单词/菜单/系统级专用词汇匹配
                - 零成本本地修正 (Save->保存, Load->读取)
                            │
                            ▼
               [ 2. 写入秩防护与防覆盖检查 ]
                - manual (4) / import (3): 绝对受保护，跳过
                - live:* (1) / manual:optimize (0): 允许升级
                            │
                            ▼
               [ 3. 闲时调度器 Idle / Batch Optimizer ]
                - 监听 getGamePresence() 心跳
                - 监听 liveTranslate 实时对白通道 (优先打断)
                - 动态配额与安全并发控制
                            │
                            ▼
               [ 4. 优化引擎派发与安全双写 ]
                - 派发至合格引擎进行二次润色与长句优化
                - 校验控制码 (__C0__ / \C[2] / \FS 等)
                - 写回 shared-cache 与 本作 ndjson (rank 守秩)
```

## 2. 游戏术语（Game Terms）库扩展与纠偏算法

### 2.1 常见游戏词汇库扩展（lib/translate/game-terms.ts）

扩展内置的 `GAME_TERMS`，补充经典游戏界面、菜单、交互词汇：

- `save`: { zh: 保存, en: Save, ja: セーブ, ko: 저장 }, 别名: [Save Game, セーブする]
- `load`: { zh: 读取, en: Load, ja: ロード, ko: 불러오기 }, 别名: [Load Game, ロードする]
- `new_game`: { zh: 新游戏, en: New Game, ja: ニューゲーム, ko: 새 게임 }
- `continue`: { zh: 继续游戏, en: Continue, ja: コンティニュー, ko: 이어하기 }
- `options`: { zh: 设置, en: Options, ja: 設定, ko: 설정 }, 别名: [Option, Config]
- `item`: { zh: 道具, en: Item, ja: アイテム, ko: 아이템 }
- `skill`: { zh: 技能, en: Skill, ja: スキル, ko: 스킬 }
- `equip`: { zh: 装备, en: Equip, ja: 装備, ko: 장비 }
- `status`: { zh: 状态, en: Status, ja: ステータス, ko: 상태 }
- `quit`: { zh: 退出, en: Quit, ja: 終了, ko: 종료 }, 别名: [Exit]
- `gold`: { zh: 金币, en: Gold, ja: 所持金, ko: 소지금 }

### 2.2 术语快速纠偏与剥壳匹配

在 `lookupGameTerm` 基础之上，提供批量检测与纠偏辅助方法：

```typescript
export function fixKnownBadGameTermTranslation(source: string, currentTarget: string, targetLanguage?: GameTermLanguage): string | null
```

当判定某个词源为 `Save` 但历史译文为“节省”或“拯救”时，直接安全修正为“保存”；`Load` 历史译文为“负荷”或“装载”时修正为“读取”。
修正过程严格保留控制字符、外层括号与语气符号。

## 3. 批量优化与闲时调度实现

### 3.1 闲时状态判定（Idle Detection）

结合 `services/runtime/presence.ts` 与实时翻译计数：

- **离线闲时（Offline Idle）**：`getGamePresence().online === false`，表明当前无任何游戏在运行，系统资源充裕，可以启动优化工作。
- **局内闲时（In-game Idle）**：游戏正在运行（`online === true`），但自上次收到实时对白翻译请求（`lastLiveTranslateAt`）已过去超过阈值（如 5 秒），且当前在途实时请求数为 0。
- **实时抢占（Preemption）**：一旦收到新的实时请求，闲时任务立即调用 `AbortController` 或暂停后续派发，释放连接与 CPU/GPU 算力。

### 3.2 批量优化任务（Optimize Session & Job）

在 `services/translate/` 下设计可持久化的优化作业或扩展现有调度机制：

- **扫描目标**：遍历当前游戏缓存或已有翻译结果，筛选出待优化候选集合：
  1. 命中知名错误术语项（可立即离线纠正）；
  2. 来源为机翻低秩（`live:*`）且未经精翻的条目。
- **守秩写回**：
  - 术语纠偏写入 `builtin:terms` 或升级现有机翻；
  - 引擎优化写入标记为 `live:agent:optimize` 或相应引擎标记；
  - 遇到人工 `manual`（Rank 4）或 `import`（Rank 3）条目直接跳过，绝不修改。
- **控制码一致性验证**：优化后的译文必须通过 `isUsefulTranslation` 及控制码完整性校验（`__C0__` 占位符、RM 转义序列），若丢失或错位则视为无效，保留原译文。

## 4. API 与控制台接入

- **/api/translate 扩展 mode: optimize**：
  - `action: scan`：扫描当前游戏有哪些条目可被优化（术语纠偏数量、机翻待优化数量）；
  - `action: apply-terms`：一键执行已知术语快速纠偏，直接更新缓存并返回统计结果；
  - `action: batch-optimize`：按批次执行二次翻译优化。
- **状态统计响应**：返回 `{ totalScanned, termsFixed, engineOptimized, skippedManual }`。
