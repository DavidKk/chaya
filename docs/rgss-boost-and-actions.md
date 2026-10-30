# RGSS 游戏加速、移动倍率与运行动作需求文档

- **日期**：2026-10-28
- **状态**：草案（待技术方案评审后开工）
- **对应技术方案**：[technical/rgss-boost-and-actions.md](technical/rgss-boost-and-actions.md)
- **关联文档**：[capabilities.md](capabilities.md)（能力总表与边界）、[edit-battle.md](edit-battle.md)（战斗面板）、[rgss-webview-overlay.md](rgss-webview-overlay.md)（RGSS 通信与浮层）
- **有效范围**：覆盖 RPG Maker VX / VX Ace（RGSS2 / RGSS3）引擎的全局倍速、角色移动倍率调节、瞬时运行动作（一键胜利、一键逃跑、场景修复等），并系统明确与 MV 插件能力的对齐矩阵与可行性边界。

---

## 1. 背景与核心痛点

当前 Chaya 的 MV / MZ 插件体系（`plugins/mv/`）已具备成熟的游戏体验增强套件：

1. **ChayaBoost**：支持行走 / 奔跑独立倍率、总是奔跑、1x–5x 全局游戏加速；
2. **运行动作（`runAction`）**：支持一键胜利、一键逃跑、秒杀敌人、全体回血，以及卡死时的强制回地图、回标题、清空事件解释器等。

而在 RGSS（VX / VX Ace，基于 mkxp-z 宿主与内嵌 WebView）中，现状存在明显断层与技术脱节：

- **已有“自动胜利”，却无“一键胜利”**：底层 Ruby 已有清怪并触发胜利结算的代码，但仅作为每帧轮询的持续开关（`autoWin`），缺少由快捷键或面板点击触发的单次瞬时动作（`battle:victory`）；且原有代码在战后结算中未完全关闭战斗输入窗口，容易残留焦点导致空指针（`nil.index`）崩溃。
- **RGSS2（VX）与 RGSS3（VX Ace）底层断层**：现有的 `autoWin` 钩子硬依赖 `defined?(BattleManager) && defined?(SceneManager)`。然而在 RPG Maker VX（RGSS2）中，根本不存在 `BattleManager`（战斗逻辑全在 `Scene_Battle` 内）与 `SceneManager`（场景由全局变量 `$scene` 管理），导致旧有逻辑在纯 VX 游戏中完全失效。
- **缺乏游戏加速与移动倍率**：`bridge.rb` 的会话状态中常年硬编码 `walkRate: 1, runRate: 1, gameSpeed: 1`，前端亦将滑块硬隐藏（`hideSpeedSliders={true}`），玩家在长迷宫或拖沓战斗中无法倍速跳过。
- **能力边界模糊**：用户直觉上认为“MV 很多功能感觉 RGSS 都能做”，但缺乏清晰的实现矩阵，哪些属于机制相通仅待接线、哪些属于底层差异不可行，没有系统定论。

---

## 2. 核心目标

| 编号   | 目标                   | 玩家感知与衡量标准                                                                                                                  |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | **游戏全局加速**       | 支持 1x–5x 游戏整体运行倍速（含战斗、移动、事件执行），保持音画节奏可控，按需开启。                                                 |
| **G2** | **角色移动倍率**       | 支持行走与奔跑移动速度单独设置（如 1x、1.5x、2x），随从步调一致，不出现穿墙、卡死或步进不同步。                                     |
| **G3** | **战斗瞬时动作**       | 战斗中随时可通过浮层或快捷键触发“一键胜利”（`battle:victory`）与“一键逃跑”（`battle:escape`），无需等待整个回合或依赖自动胜利开关。 |
| **G4** | **场景与卡死修复动作** | 探索与交互中发生死锁或死循环时，可通过“回地图”、“回标题”、“清空事件”、“关闭全部窗口”恢复操作。                                      |
| **G5** | **能力矩阵与边界收敛** | 明确 MV 与 RGSS 插件功能对齐清单，界定受限不可做项，避免盲目迁移。                                                                  |

---

## 3. 功能详细说明

### 3.1 游戏加速与移动倍率（Boost）

针对用户核心关切：“**vx 游戏可以加速吗？类似 mv 的**”：

- **可行性结论**：**完全可行**。RGSS 引擎底层具备原生 `Graphics.frame_rate` 时钟调节能力，且可通过主循环跳帧进行超高倍速扩展。
- **全局游戏倍速（`gameSpeed`）**：
  - **调节范围**：1.0x – 5.0x（默认 1.0x，步进 0.25x 或 0.5x，与 UI 滑块对齐）。
  - **效果表现**：整体加快事件解析、战斗回合、角色行走与过场动画；事件等待帧数（如等待 60 帧）等比缩短。
  - **音频保真**：BGM 为流式异步音频播放，加速**不会**导致背景音乐变调或怪异尖叫；音效（SE）随动作自然触发。
  - **平台自适应策略**：
    - **macOS（mkxp-z 宿主）**：mkxp-z 原生支持突破 120 帧上限，直接动态调节 `Graphics.frame_rate`（例如 2x=120, 3x=180, 5x=300 FPS），画面与逻辑极度平滑。
    - **Windows 原版 Game.exe（RGSS DLL）**：RGSS 官方 DLL 将 `Graphics.frame_rate` 硬限制在 10..120 FPS（最高 2x）。1x–2x 走原生帧率；>2x 或开启垂直同步（锁 60 帧）时，自适应切入主循环跳帧快进（单物理帧执行多次场景逻辑与输入更新）。
  - **安全平滑保护**：切换地图场景（`Scene_Map` 初始化）与存档读档瞬间自动恢复 60 FPS 基线，待场景渲染稳定后再恢复倍速，防止黑屏加载与资源初始化受高频时钟冲击。
- **行走与奔跑倍率（`moveRate` / `walkRate` / `runRate`）**：
  - **调节范围**：0.5x – 4.0x（前端滑块为 0.5x – 8.0x，Ruby 端设 4.0x 安全上限防穿墙）。
  - **效果表现**：线性缩短每格行走耗时；随从（Followers）同步紧随，不发生队伍脱节。
  - **双引擎兼容**：
    - RGSS3（VX Ace）：挂钩 `Game_CharacterBase#distance_per_frame`，随从 `Game_Follower` 同步应用倍率；
    - RGSS2（VX）：挂钩 `Game_Character#distance_per_frame`，仅对 `Game_Player` 生效（VX 原版无原生随从队列）。
  - **协同工作**：与 `alwaysDash`（总是奔跑）协同生效，奔跑时在奔跑基础速率上叠乘 `runRate`。

### 3.2 战斗即时动作（`battle:*`）

针对用户核心关切：“**明明可以自动胜利但是没有一键胜利？**”：

- **现状根因**：原先仅实现了每帧轮询状态的 `autoWin` 开关，未开放单次瞬时的 `op: 'runAction'` 协议分发，且前端隐藏了动作工具栏。
- **一键胜利（`battle:victory`）**：
  - **触发条件**：当前处于战斗中（`live_battle_scene` 有效），且处于有效行动或输入阶段。
  - **执行流程**：
    1. 瞬间将敌方全体生命值归 0（`enemy.hp = 0`），触发引擎自然判定；
    2. **彻底停用并关闭全部战斗子窗口**（派生指令窗口、技能/物品窗口、目标选择窗口），避免战后对白中残留焦点导致空指针崩溃（解决 RGSS 原生 `nil.index` 隐患）；
    3. 驱动引擎结算管线：RGSS3 调用 `BattleManager.process_victory`；RGSS2 调用 `scene.process_victory` 或 `scene.battle_end(0)`。
  - **安全状态机**：若战斗处于初始切入阶段（`:init`）或当前正在执行剧情对话事件（`$game_troop.interpreter.running?` 为 true），自动等待对话结束后再执行，保护剧情不被生硬破坏。
- **一键逃跑（`battle:escape`）**：
  - **100% 强制脱战**：直接调用脱战管线（RGSS3 走 `BattleManager.process_abort`；RGSS2 走 `scene.battle_end(1)`），彻底规避原版 `rand < @escape_ratio` 随机概率判定，杜绝逃跑失败被怪围攻。
- **一键战败（`battle:defeat`）与中止（`battle:abort`）**：
  - 用于特殊剧情支线收集、送命读档或中断死循环战斗。
  - RGSS3 走 `BattleManager.process_defeat / abort`；RGSS2 走 `scene.battle_end(2)`。
- **敌我生命即时调整**：
  - `battle:enemyHp1`：敌人全体血量变 1（刀刀秒杀）；
  - `battle:partyHeal`：我方全体血量与魔法回满；
  - `battle:partyHp1` / `battle:partyHp0`：我方全员濒死或全灭。

### 3.3 场景导航与卡死修复动作（`scene:*` / `fix:*`）

- **紧急脱困动作**：
  - `fix:map`：强行切回主地图场景（RGSS3: `SceneManager.goto(Scene_Map)`；RGSS2: `$scene = Scene_Map.new`），解脱各类死锁。
  - `fix:title`：放弃当前进度立即回到标题画面（RGSS3: `SceneManager.goto(Scene_Title)`；RGSS2: `$scene = Scene_Title.new`）。
  - `fix:clearEvent`：清空当前正在卡死循环的解释器指令列表、消息状态与移动路线。
  - `fix:clearMoveRoute`：重置玩家与地图事件的自定义移动路线。
  - `fix:closeWindows`：遍历当前场景的所有活跃窗口并执行 `close` / `deactivate`，消除废弃悬浮窗。
  - `fix:fadeIn`：强制淡入画面（调用 `Graphics.fadein(1)`），解除黑屏假死。
- **快捷场景跳转**：
  - 一键呼出原生物品（`scene:item`）、技能（`scene:skill`）、装备（`scene:equip`）、存档（`scene:save`）。

### 3.4 交互与控制台解禁

- **浮层与外部控制台全面解禁**：
  - `plugins/rgss/src/Workbench.tsx`（游戏内嵌浮层）：移除 `hideRunTools={true}` 与 `hideSpeedSliders={true}`；
  - `components/GameEditPage.tsx`（外部 Web 控制台）：移除 `hideRunTools={isRgss}` 与 `hideSpeedSliders={isRgss}`；
  - `components/game-edit/supported.ts`：导出 `RGSS_SUPPORTED_RUN_ACTIONS` 白名单，供工具栏过滤渲染。
- **关闭联动（`runActionNeedsClose`）**：
  - 触发 `battle:victory`、`battle:escape`、`fix:map`、`fix:title` 等大场景转换动作时，浮层自动收起焦点，让玩家直观看到游戏结算画面。

---

## 4. MV 插件能力对齐与边界判定矩阵

针对用户核心关切：“**mv 的插件还有很多内容，感觉都能做，帮我重新确认哪些可以完成哪些不行**”：

| 分组               | 功能项                                                 | MV 现状    | RGSS 现状    | 本期规划        | 可行性与技术原因判定                                                                                                               |
| ------------------ | ------------------------------------------------------ | ---------- | ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **基础数值修改**   | 金钱、物品、武器、防具、变量、开关                     | ✓ 完整支持 | ✓ 完整支持   | 保持            | **完全可行**。双端机制一致，数据结构完全映射，已完整落地。                                                                         |
|                    | 角色属性（HP/MP/等级/技能/状态）                       | ✓ 完整支持 | ✓ 完整支持   | 保持            | **完全可行**。已完整落地。                                                                                                         |
|                    | 持续锁定（金钱/物品/角色属性）                         | ✓ 完整支持 | ✓ 完整支持   | 保持            | **完全可行**。在 Ruby 帧循环中持续回写基线。                                                                                       |
| **运行辅助开关**   | 穿墙（`through`）、不遇敌（`encounter`）               | ✓ 完整支持 | ✓ 完整支持   | 保持            | **完全可行**。通过 `Game_Player#through?` 与遇敌步数实现。                                                                         |
|                    | 总是奔跑（`alwaysDash`）                               | ✓ 完整支持 | ✓ 完整支持   | 保持            | **完全可行**。RGSS3 设 Config/dash?，RGSS2 强设 dash? 为 true。                                                                    |
|                    | 自动对话（`autotalk`）、跳过结算（`skipBattleResult`） | ✓ 完整支持 | ✓ 完整支持   | 保持            | **完全可行**。挂钩 `Window_Message` 与胜利结算画面。                                                                               |
|                    | 自动战斗（`autoBattle`）、自动胜利（`autoWin`）        | ✓ 完整支持 | ✓ 仅 Ace     | **支持 (P0)**   | **完全可行**。补齐 RGSS2（VX）兼容，不再硬依赖 `BattleManager`。                                                                   |
|                    | 全屏切换（`fullscreen`）                               | ✓ 完整支持 | ✗ 占位       | **支持 (P1)**   | **完全可行**。调用 `Graphics.fullscreen = !Graphics.fullscreen` 或模拟 Alt+Enter。                                                 |
|                    | 锁血无敌（`god`）                                      | ✓ 完整支持 | ✗ 仅占位     | **支持 (P1)**   | **完全可行**。在 `EditRuntime.tick` 中监控并补满队伍 HP/MP。                                                                       |
|                    | 随从隐藏（`followers`）                                | ✓ 完整支持 | ✗ 仅占位     | **支持 (P1)**   | **部分支持**。RGSS3 可控制 `Game_Followers#visible=`；RGSS2 原版无随从队列，带保护后忽略。                                         |
|                    | 点击传送（`clickTeleport`）                            | ✓ 完整支持 | ✗ 仅占位     | **支持 (P1)**   | **完全可行**。结合现有 `mouse_movement.rb` 坐标直接改写玩家地图位置。                                                              |
|                    | 资源防崩跳过（`resourceSkip`）                         | ✓ 完整支持 | ✗ 不支持     | **不可行**      | **不可行**。MV 为 Web 架构，缺失图片可返回 1x1 透明图片；RGSS 的底层图片/音频由 C++ SDL/DirectX 打开，缺失直接抛 Native 弹窗闪退。 |
| **速度与倍率**     | 游戏全局加速（`gameSpeed`）                            | ✓ 完整支持 | ✗ 仅占位     | **支持 (P0)**   | **完全可行**。mkxp-z 原生高帧率，Windows 原版走原生 120 帧 + 主循环多重 update 跳帧。                                              |
|                    | 移动倍率（`moveRate` / `walkRate` / `runRate`）        | ✓ 完整支持 | ✗ 仅占位     | **支持 (P0)**   | **完全可行**。线性叠乘 `distance_per_frame`，RGSS2 (`Game_Character`) 与 RGSS3 (`Game_CharacterBase`) 双轨适配。                   |
| **瞬时动作**       | 一键胜利（`battle:victory`）                           | ✓ 完整支持 | ✗ 缺少分发   | **支持 (P0)**   | **完全可行**。补齐 `op: 'runAction'` 路由，清怪 + 彻底注销输入窗口 + 双引擎结算管线。                                              |
|                    | 一键逃跑（`battle:escape`）                            | ✓ 完整支持 | ✗ 缺少分发   | **支持 (P0)**   | **完全可行**。直接触发脱战中断（`process_abort` / `battle_end(1)`），100% 成功。                                                   |
|                    | 一键战败 / 中止（`defeat` / `abort`）                  | ✓ 完整支持 | ✗ 缺少分发   | **支持 (P1)**   | **完全可行**。清空队伍生命或中断战斗。                                                                                             |
|                    | 敌我血量动作（全体回满、敌人 1 血）                    | ✓ 完整支持 | ✗ 缺少分发   | **支持 (P1)**   | **完全可行**。遍历 `$game_troop` / `$game_party` 改写 HP。                                                                         |
|                    | 场景脱困（`fix:map` / `fix:title` / `fix:clearEvent`） | ✓ 完整支持 | ✗ 缺少分发   | **支持 (P1)**   | **完全可行**。基于 `SceneManager` / `$scene` 切换与解释器重置。                                                                    |
|                    | 窗口清理与淡入（`fix:closeWindows` / `fix:fadeIn`）    | ✓ 完整支持 | ✗ 缺少分发   | **支持 (P1)**   | **完全可行**。关闭活跃窗口并调用 `Graphics.fadein`。                                                                               |
|                    | 脚本异常恢复（`fix:resume`）                           | ✓ 完整支持 | ✗ 不支持     | **不可行**      | **不可行**。MV 异常被 catch 后依然存活；RGSS 未捕获异常直接触发进程退出崩溃，无法在异常后原位热恢复，必须靠前置防御性 guard。      |
| **战斗完整面板**   | 实时敌我卡片、选人加血、替换怪物                       | ✓ 完整支持 | ✗ 未开放     | **后续 (P2)**   | **可行但需开发**。RGSS 需建立战斗状态到 WebView 的周期性 JSON 状态广播协议。                                                       |
| **脚本控制台**     | 实时执行任意代码（`eval`）                             | ✓ DevTools | ✗ 不开放     | **受限/不开放** | **不开放**。MV 为同进程 JS，RGSS 为跨进程 Ruby VM 桥接，开放任意 eval 极易破坏 Ruby Fiber 栈与内存安全，仅暴露安全有界指令。       |
| **视觉与特效**     | 画面 Canvas 滤镜、DOM 注入                             | ✓ 完整支持 | ✗ 不支持     | **不可行**      | **不可行**。RGSS 渲染层为原生 SDL2/Direct3D，浮层 WebView 无法向底层原生纹理注入 WebGL/CSS 滤镜。                                  |
| **Agent 高频感知** | 毫秒级画面取帧截屏                                     | ✓ 完整支持 | ◐ 仅基础截图 | **受限**        | **受限**。RGSS 显存拉取到 CPU 跨进程传输成本高，只适合低频单次截图，不支持每秒数十帧的视觉流。                                     |

---

## 5. 分期规划与验收标准

### 5.1 第一期（P0 核心加速、移动倍率与一键胜利/逃跑）

1. **协议打通**：`edit.cmd` 支持 `op: 'moveRate'`、`op: 'gameSpeed'` 与 `op: 'runAction'`，Ruby 端统一出队执行，不再报未识别操作异常；
2. **一键胜利**：战斗中触发 `battle:victory`，敌群清空且安全进入胜利结算流程，不留残留输入窗口，RGSS2 与 RGSS3 均可稳定结算；
3. **一键逃跑**：战斗中触发 `battle:escape`，100% 成功脱战回到地图；
4. **游戏倍速**：可设置 `gameSpeed`（1x–5x），游戏整体逻辑与动画成倍加速，切图不崩溃；
5. **移动倍率**：可设置 `moveRate`，人物移动按设定速度加快，随从同步；
6. **前端解禁**：内嵌浮层与外部控制台的滑块与动作按钮全部可用。

### 5.2 第二期（P1 战斗辅助与脱困修复动作）

1. 一键战败（`battle:defeat`）、中止战斗（`battle:abort`）；
2. 敌方全 1 血（`battle:enemyHp1`）、我方全满血（`battle:partyHeal`）；
3. 常用卡死修复动作（`fix:map`、`fix:title`、`fix:clearEvent`、`fix:clearMoveRoute`、`fix:closeWindows`、`fix:fadeIn`）；
4. 常用场景快捷唤出（`scene:item / skill / equip / save`）；
5. 辅助开关补齐：锁血无敌（`god`）、全屏切换（`fullscreen`）、点击瞬移（`clickTeleport`）、随从隐藏（`followers`）。

### 5.3 第三期（P2 战斗面板数据底座）

1. 建立 RGSS 战斗状态（敌我阵容、当前血量、行动顺序）到 WebView 的周期性 JSON 同步管线，为后续独立战斗面板提供支撑。
