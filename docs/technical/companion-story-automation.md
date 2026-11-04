# 旅伴全托管剧情推进与地图自律导航技术架构

## 1. 架构总览

全托管剧情推进系统采用**“底层高敏执行 + 顶层自律状态机 + 异步分级模型”**的三层分层架构，既保障高频游戏输入的实时性与鲁棒性，又兼顾剧情分支抉择与卡点推理的智能化：

```
+-----------------------------------------------------------------------------------+
|                            Chaya 客户端 / 旅伴主面板                                |
|  - 状态监控（当前地图 / 场景 / 托管状态）   - 玩家随时接管与暂停   - 独立伴游聊天窗口   |
+-----------------------------------------------------------------------------------+
                                         |
                       WebSocket / IPC / HTTP RPC 桥接
                                         v
+-----------------------------------------------------------------------------------+
|                        旅伴自律宿主（Companion Core Host）                          |
|                                                                                   |
|  [自律状态机 StoryCoordinator]                                                     |
|    |--> 标题处理 (Scene_Title -> NewGame)                                         |
|    |--> 剧情推进 (Scene_Message -> 自动打字机快进 + 人性化阅读短停顿)                 |
|    |--> 分支决断 (ChoiceArbiter: L0规则过滤 -> L1小模型推理 -> 超时兜底)            |
|    |--> 地图探索 (ExplorationPlanner: 拓扑提取 -> 优先级选择 -> A*寻路 -> 交互)    |
|    |--> 战斗交接 (BattleCoordinator: 复用已验证的高性能本地战斗核心)               |
|    +--> 卡死感知 (StuckDetector: 停滞超时检测 -> 提取情境事实 -> 模型自救)        |
|                                                                                   |
|  [多模型异步调度器 ModelScheduler]                                                |
|    |-- 决策通道 (L1 Choice / Stuck Recovery) -> 局域网 Ollama MBA (qwen3:4b, T=0.1) |
|    +-- 闲聊通道 (Banter / Chat Companion)   -> 异步并发，严格不抢占输入控制权      |
+-----------------------------------------------------------------------------------+
                                         |
                       插件挂载与内存探测 (ChayaAgent / MV Bridge)
                                         v
+-----------------------------------------------------------------------------------+
|                           RPG Maker 引擎运行环境 (In-Game)                         |
|  - Window_Message Hook (自动快进、字数自适应停顿、台词流式收集)                    |
|  - Window_ChoiceList Hook (选项挂钩、索引选择、确定执行)                          |
|  - Map Topology Sensor ($gameMap 事件网格、触发器属性、门/箱/NPC 分类)             |
|  - Smart Path & Touch Move (基于现有增强寻路的平滑碰撞移动)                       |
|  - Scene FSM ($gameParty, $gameTroop, SceneManager._scene 变化追踪)                |
+-----------------------------------------------------------------------------------+
```

---

## 2. 引擎内部探测与执行器实现

### 2.1 剧情消息驱动器（DialogueDriver）
- **挂钩入口**：`Window_Message.prototype`（扩展自已有的 `auto-talk.ts`）。
- **自然停顿算法**：
  - 快进输出：在 `updateShowFast` 中将 `_showFast = true`，跳过字符逐个渲染等待；
  - 自适应停顿：在 `updateInput` 中检测到 `this.pause`（文本已打印完毕、等待玩家按键）时，计算舒适停顿帧数：
    ```ts
    const textLen = this._textState ? (this._textState.text || "").length : 20;
    const baseFrames = 8; // 约 130ms
    const extraFrames = Math.min(24, Math.floor(textLen / 8)); // 每8个字多停留40ms，上限400ms
    const waitFrames = baseFrames + extraFrames;
    ```
  - 倒计时归零后，触发 `this.terminateMessage()` 并模拟确认键流转。
- **对话历史流转收集**：
  - 每次打开新消息窗口时，提取发言人名称（`_nameWindow` 或立绘前缀）、立绘名称（`_faceName`）及去除转义符后的干净正文；
  - 存入全局有界循环队列 `dialogue_history`（保留近 50 条），供分支决策与聊天上下文随时回溯。

### 2.2 选项仲裁与执行器（ChoiceController）
- **挂钩入口**：`Window_ChoiceList.prototype.update` 与 `start`。
- **探测接口**：
  - 当 `$gameMessage.isChoice()` 为真时，通过代理接口提取当前选项列表：
    ```ts
    type ChoiceContext = {
      choices: string[];
      defaultIndex: number;
      cancelType: number;
      recentDialogue: Array<{ speaker: string; text: string }>;
    }
    ```
- **分级决断管道**：
  1. **L0 规则直通**：
     - 若当前地图为 215 且选项包含“第一幕”或 `1Prolog_bgn_2`，直接指定选项 `0`；
     - 若选项为常见系统确认（如“是 / 否”、“进入 / 离开”、“确认 / 取消”），优先根据目标上下文判定默认项。
  2. **L1 小模型推理（`qwen3:4b`）**：
     - 构建紧凑 JSON 提示词：包含近 5 句台词、当前选项列表、旅伴人设目标；
     - 约定格式：`{"choice_index": 0, "reason": "接受公会会长试炼"}`；
     - 调用局域网 Ollama MBA 接口，限制超时为 3.5 秒。
  3. **L2 兜底回退**：
     - 超时或解析失败时，直接选中 `defaultIndex >= 0 ? defaultIndex : 0`，绝不卡死游戏。
- **安全提交**：
  - 确认选中项后，调用 `choiceWindow.select(targetIndex)`，紧接着在下一帧调用 `choiceWindow.callOkHandler()` 完成交互。

### 2.3 地图拓扑传感器与寻路交互（MapNavigator）
- **事件分类与感知**：
  - 每当玩家处于 `Scene_Map` 且无剧情解释器运行时，扫描 `$gameMap.events()`：
    1. **传送点（Teleports）**：事件指令中含有代码 `201`（Transfer Player）且触发器为碰触（`trigger === 1 || trigger === 2`）或按键触发（`trigger === 0`）；
    2. **宝箱/掉落（Loot）**：名称含 `Сундук` / `Chest` / `宝箱`，或具有独立开关 A 未开启；
    3. **可对话 NPC**：名称具有可读名且未处于已完成页。
- **寻路与避障**：
  - 利用现有的 `smart-path`（A* 避障与事件碰撞体规避）；
  - 目标点选定后，调用移动控制器将玩家引导至目标邻近网格（对于接触类传送门则直接移动至该格）；
  - 抵达后使玩家面向事件，派发 Action 触发键。

### 2.4 遭遇战斗交接（Battle Bridge）
- **检测入口**：`SceneManager._scene instanceof Scene_Battle`。
- **调度**：
  - 地图推进状态机立即挂起；
  - 唤醒已下沉至 `plugins/mv/src/helpers/game/battle-effects.ts` 的**旅伴战斗核心（Companion Battle Core）**；
  - 战斗过程完全在本地以单步 1ms 级别运行（选攻击/最佳克制技能/回血道具）；
  - 战斗胜利结算（确认结算界面）并切回 `Scene_Map` 后，自律状态机重新扫描当前地图，标记最近战点并继续前行。

---

## 3. 多模型并发与控制权仲裁

### 3.1 决策与闲聊双轨模型解耦
- **决策轨（Action/Choice Brain）**：
  - 模型：局域网 Ollama MBA（`qwen3:4b`）；
  - 配置：`temperature: 0.1`，`max_tokens: 120`；
  - 职能：严格面向动作、选项、卡点求助，输出严格校验的 JSON 指令。
- **闲聊轨（Chat/Banter Companion）**：
  - 模型：用户配置的主模型或独立通道；
  - 职能：响应玩家主动聊天，或在剧情转折点主动发声；
  - 隔离：闲聊轨产生的所有输出仅投递给 UI 渲染，**没有任何权限修改游戏输入缓冲、按键状态或改变自律状态机走向**，从架构上物理杜绝“双模型打架”。

### 3.2 停滞卡死检测与恢复状态机（StuckDetector）
- **检测指标**：
  - 记录三元组：`(mapId, playerX, playerY, lastActionTimestamp)`；
  - 滑动窗口：若在 25 秒内玩家未发生有效位移、地图未切换、且未触发任何事件解释器，判定为疑似卡死。
- **恢复策略**：
  1. 第一阶段（物理脱困）：尝试向四个方向随机移动 1–2 格，解除卡角或偶发碰撞死锁；
  2. 第二阶段（重新建图）：刷新全图事件可达性缓存，更换次优探索目标；
  3. 第三阶段（模型诊断）：提取当前地图名称、NPC 对话摘要与任务变量（`$gameVariables`），向小模型提问下一步逻辑目标。

---

## 4. 目标游戏（Heroines II）序章落地方案

针对标杆游戏《Heroines of Swords & Spells II》（ID `cfbafc20-c4d9-4b96-ad07-21ce55722678`）的具体落地推进链条：

1. **起点（Map 215）**：
   - 自动运行事件 Event 1 弹出选单；
   - `ChoiceController` 感知 `{1Prolog_bgn_2}`（第一幕），自动执行 Choice 0；
   - 游戏触发代码 `201` 将玩家传送到 Map 1（x: 8, y: 12）。
2. **第一幕公会厅（Map 1）**：
   - Event 10 自动剧情播放，`DialogueDriver` 保持自然打字机阅读节奏自动过对话；
   - 玩家进入自由控制后，`MapNavigator` 锁定公会大师（Event 12: Магистр Теней，坐标 8, 3）；
   - 自动走到大师跟前对话，处理多轮考核分支选项（全部选择推进剧情的积极选项）；
   - 考核完毕，会长打开地道，`MapNavigator` 锁定“秘密通道”（Event 14: Тайный спуск，坐标 15, 11）；
   - 走到通道口触发转移，切图进入地下试炼区（Map 4 / Map 5 / Map 6）。
3. **试炼地牢（Map 4/5/6）**：
   - 开启宝箱（获取初始盗贼匕首与金币），解开机关；
   - 遭遇史莱姆/哥布林明雷战，平滑交接至本地战斗核心，秒级获胜；
   - 遍历试炼地图直到触发过关事件，顺利达成序章目标。

---

## 5. 资源防护与单实例约束

1. **单实例端口与进程守护**：
   - 无论自动化运行器还是开发调试服务，拉起前均执行全局进程互斥扫描；
   - 通过 `ps -eo pid,command` 匹配 `Chaya.app|nwjs|mkxp|electron` 并调用 SIGTERM/SIGKILL 终结旧进程。
2. **默认静音设置**：
   - 在 NW.js / Chromium 启动参数注入 `--mute-audio`，避免后台测试时突然爆音。
3. **免 Lint/Format 循环打扰**：
   - 遵循用户指令：在特性开发与端到端实测验证期间，不主动执行 ESLint 或代码美化，全力保障业务逻辑与真机效果；
   - 测试验收全部确认达标后，再收口清理。
