# RGSS 游戏加速、移动倍率与运行动作技术方案

- **日期**：2026-10-28
- **状态**：草案（待评审）
- **对应需求**：[`../rgss-boost-and-actions.md`](../rgss-boost-and-actions.md)
- **关联模块**：`plugins/rgss/`（`bridge.rb`, `edit_runtime.rb`, `input.rb`）、`components/game-edit/`（`types.ts`, `supported.ts`, `GameEditWorkbench.tsx`）、`components/GameEditPage.tsx`
- **有效范围**：覆盖 RPG Maker VX / VX Ace（RGSS2 / RGSS3 引擎及 mkxp-z 宿主）下的倍速调控、移动倍率注入、`runAction` 协议分发、战斗即时结算与场景安全保护。

---

## 1. 总体架构与调用链路

```text
[内嵌 WebView / 外部网页控制台]
  │
  ├─ 界面操作 / 快捷键触发
  │    ├─ onRunAction(id)        → postMessage({ type: 'edit.cmd', op: 'runAction', id })
  │    ├─ onMoveRateChange(rate) → postMessage({ type: 'edit.cmd', op: 'moveRate', value: rate })
  │    └─ onGameSpeedChange(spd) → postMessage({ type: 'edit.cmd', op: 'gameSpeed', value: spd })
  │
  ▼
[Bridge.pump (Ruby 运行时，主线程循环)]
  │
  ├─ 消息出队与验签（LIMIT 有界队列）
  ▼
[EditRuntime.apply / write]
  │
  ├─ when 'gameSpeed' → 更新倍速状态，设置 Graphics.frame_rate 与主循环跳帧调度
  ├─ when 'moveRate'  → 更新移动倍率状态，线性挂钩 distance_per_frame
  ├─ when 'runAction' → 进入 handle_run_action(id) 分发
  │     ├─ 'battle:victory' → 校验 phase → 清空敌群 HP → 停用/关闭输入窗口 → 双引擎结算管线
  │     ├─ 'battle:escape'  → 强制脱战 (RGSS3: process_abort; RGSS2: battle_end(1))
  │     ├─ 'battle:defeat'  → 队伍 HP 归 0 → process_defeat / battle_end(2)
  │     ├─ 'fix:map'        → SceneManager.goto(Scene_Map) / $scene = Scene_Map.new
  │     └─ 'fix:title'      → SceneManager.goto(Scene_Title) / $scene = Scene_Title.new
  │
  ▼
[状态回执]
  └─ dispatch_reply(full_session_state) → 实时同步 gameSpeed、walkRate、runRate 等数值
```

---

## 2. RGSS2（VX）与 RGSS3（VX Ace）引擎差异对照

在设计跨引擎功能时，必须严格区分两代引擎的核心架构与全局对象差异：

| 机制 / 概念      | RPG Maker VX Ace（RGSS3）                                         | RPG Maker VX（RGSS2）                                                            | 技术适配策略                                                                                                                  |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **场景管理容器** | `SceneManager.scene` / `SceneManager.goto(cls)`                   | 无 `SceneManager`；全局变量 `$scene` 持有当前场景，切场景直接 `$scene = cls.new` | 提供统一的 `live_battle_scene` 与 `goto_scene` 抽象方法，优先探测 `SceneManager`，回退到 `$scene`                             |
| **战斗调度中枢** | 独立静态类 `BattleManager`，掌控 phase 状态与胜负脱战结算         | 无 `BattleManager`；战斗状态机、窗口与胜负流程全部内聚在 `Scene_Battle` 实例内部 | 检查 `defined?(BattleManager)`：存在则调用 `BattleManager`，否则在 `Scene_Battle` 实例上调用 `process_victory` / `battle_end` |
| **角色基类**     | `Game_CharacterBase`（`Game_Character` 的父类）                   | 无 `Game_CharacterBase`；角色基类为 `Game_Character`                             | 动态解析基类：`defined?(Game_CharacterBase) ? Game_CharacterBase : Game_Character`                                            |
| **移动速度计算** | `distance_per_frame`（`2 ** real_move_speed / 256.0`）            | 原版在 `update_move` 内使用定点整数步长（`2 ** move_speed`）                     | RGSS3 挂钩 `distance_per_frame`；RGSS2 挂钩 `update_move` 按倍率缩放单步像素距离                                              |
| **随从队列**     | 原生 `Game_Followers` / `Game_Follower`，随从自动跟随队长移动速度 | 原版无随从队伍（单人行走；第三方脚本扩展）                                       | 对随从加保护：`defined?(Game_Follower) && is_a?(Game_Follower)`，防止常量未定义                                               |
| **帧率上限限制** | mkxp-z 无限制；Windows 官方 dll 锁 `10..120`                      | mkxp-z 无限制；Windows 官方 dll 锁 `10..120`                                     | 跨平台双轨调度：1x–2x 调帧率，高倍率降级为主循环多重 `update`                                                                 |

---

## 3. 游戏加速与移动倍率实现方案

### 3.1 全局游戏倍速（`gameSpeed`）

#### 调控原理

在 RGSS 架构中，游戏的画面渲染、动画帧步进与逻辑更新深度绑定在 `Graphics.update` 与 `Scene_Base#main` 循环中。

1. **原生帧率调控（`Graphics.frame_rate`）**：
   - RGSS 官方提供 `Graphics.frame_rate` 接口，默认基线为 60 FPS。
   - 在 mkxp-z（macOS）环境下，可安全提升至 300 FPS。
   - **优势**：极度平滑，动画、物理、移动和事件处理等比例自然加速，且不会破坏 Ruby 内部 Fiber 的协程调度与计时。
2. **主循环跳帧调度（多重 `Scene_Base#update`）**：
   - 在 Windows 原版 `Game.exe`（官方 DLL 将 `frame_rate` clamp 在 120）或开启硬件 V-Sync 锁 60 帧的环境下，将超过 2.0x 的速度转换为逻辑快进：单次 `Graphics.update` 渲染前，循环执行逻辑与输入更新。

#### 落地双轨自适应实现

```ruby
module ChayaRGSS
  module EditRuntime
    @game_speed = 1.0

    def self.game_speed
      @game_speed || 1.0
    end

    def self.apply_game_speed(rate)
      rate = [[rate.to_f, 1.0].max, 5.0].min
      @game_speed = rate

      if defined?(Graphics) && Graphics.respond_to?(:frame_rate)
        # 基线 60 帧，根据倍率缩放
        target_fps = (60 * rate).round
        # 若在 mkxp-z 环境或支持高帧率，直接设置；原生 Windows DLL 会被系统安全 clamp 到 120
        Graphics.frame_rate = [target_fps, 300].min rescue 60
      end
    end
  end
end
```

- **切场景与读档保护**：
  在 `SceneManager.goto` / `$scene = ...` 切场景及存档读档瞬间，自动将帧率临时恢复为 60，避免黑屏加载与资源初始化受高频时钟冲击；切入新场景完成且首帧渲染后，再恢复设定倍速。

### 3.2 角色移动倍率（`moveRate` / `walkRate` / `runRate`）

在 RPG Maker VX / VX Ace 中，人物移动速度底层计算公式为：

```ruby
def distance_per_frame
  2 ** real_move_speed / 256.0
end
```

`real_move_speed` 为指数项，若直接修改该值会导致非线性速度剧烈跳变。

#### 挂钩设计与基类兼容

挂钩动态选定的角色基类，直接在线性步长上叠乘倍率，与 MV `distancePerFrame() * moveSpeedRate()` 保持完全一致的数学行为：

```ruby
target_class = if defined?(Game_CharacterBase)
                 Game_CharacterBase
               elsif defined?(Game_Character)
                 Game_Character
               end

if target_class && !target_class.method_defined?(:chaya_orig_distance_per_frame)
  target_class.class_eval do
    alias_method :chaya_orig_distance_per_frame, :distance_per_frame
    def distance_per_frame
      base = chaya_orig_distance_per_frame
      return base unless defined?(ChayaRGSS::EditRuntime)

      # 仅玩家与随从应用倍率，普通地图 NPC 保持原速
      is_player = is_a?(Game_Player)
      is_follower = defined?(Game_Follower) && is_a?(Game_Follower)
      return base unless is_player || is_follower

      is_dashing = if is_player
                     respond_to?(:dash?) && dash?
                   elsif is_follower
                     defined?($game_player) && $game_player && $game_player.respond_to?(:dash?) && $game_player.dash?
                   else
                     false
                   end
      rate = is_dashing ? ChayaRGSS::EditRuntime.run_rate : ChayaRGSS::EditRuntime.walk_rate
      rate > 0 ? base * [rate, 4.0].min : base
    end
  end
elsif target_class && target_class.method_defined?(:update_move) && !target_class.method_defined?(:chaya_orig_update_move)
  # RGSS2（VX 原版）无 distance_per_frame，步长直接在 update_move 中计算
  target_class.class_eval do
    alias_method :chaya_orig_update_move, :update_move
    def update_move
      return chaya_orig_update_move unless defined?(ChayaRGSS::EditRuntime) && is_a?(Game_Player)
      rate = (respond_to?(:dash?) && dash?) ? ChayaRGSS::EditRuntime.run_rate : ChayaRGSS::EditRuntime.walk_rate
      if rate == 1.0
        chaya_orig_update_move
      else
        distance = [(2 ** @move_speed * (@dash ? 2 : 1) * [rate, 4.0].min).round, 256].min
        @real_x = [@real_x - distance, @x * 256].max if @x * 256 < @real_x
        @real_x = [@real_x + distance, @x * 256].min if @x * 256 > @real_x
        @real_y = [@real_y - distance, @y * 256].max if @y * 256 < @real_y
        @real_y = [@real_y + distance, @y * 256].min if @y * 256 > @real_y
        @anime_count += 1
      end
    end
  end
end
```

- **随从紧密跟随**：随从在 `is_follower` 条件下同样应用 `run_rate` / `walk_rate`，确保队伍队列紧凑跟进，不产生断节或穿墙。

---

## 4. 运行动作（`runAction`）协议与双引擎分发

### 4.1 协议规范与 Ruby 分发

前端通过 `edit.cmd` 发送标准信封：

```json
{
  "type": "edit.cmd",
  "cmdId": 101,
  "op": "runAction",
  "id": "battle:victory"
}
```

Ruby 端 `EditRuntime.write(op)` 规范化分发：

```ruby
def write(op)
  case op['op']
  when 'moveRate'
    rate = Bridge.float(op['value'], 0.5, 4.0)
    apply_move_rate(rate)
    ['walkRate:0', 'runRate:0']
  when 'walkRate'
    rate = Bridge.float(op['value'], 0.5, 4.0)
    apply_walk_rate(rate)
    ['walkRate:0']
  when 'runRate'
    rate = Bridge.float(op['value'], 0.5, 4.0)
    apply_run_rate(rate)
    ['runRate:0']
  when 'gameSpeed'
    rate = Bridge.float(op['value'], 1.0, 5.0)
    apply_game_speed(rate)
    ['gameSpeed:0']
  when 'runAction'
    handle_run_action(op['id'])
    [op['id']]
  # ... 其他已有分支保持
```

### 4.2 统一场景与战斗检测抽象

```ruby
def live_battle_scene
  scene = if defined?(SceneManager) && SceneManager.respond_to?(:scene)
            SceneManager.scene rescue nil
          elsif defined?($scene)
            $scene
          end
  scene.is_a?(Scene_Battle) ? scene : nil
end

def safe_auto_win_phase?(phase)
  # RGSS3: :input, :turn, :action 阶段可安全结算；:init, :battle_end 拒绝
  AUTO_WIN_PHASES.include?(phase)
end
```

### 4.3 一键胜利（`battle:victory`）

```ruby
def execute_battle_victory
  scene = live_battle_scene
  return false unless scene && defined?($game_troop) && $game_troop
  return false if @resolving_action
  return false if troop_event_running? || battle_message_busy?

  begin
    @resolving_action = true
    # 1. 敌方全员生命归 0，触发引擎自然击倒判定
    $game_troop.members.each { |enemy| enemy.hp = 0 if enemy.respond_to?(:hp=) }

    # 2. 彻底停用并关闭全部战斗输入与选择窗口，避免在战后结算中残留焦点导致 nil.index 报错
    [:@party_command_window, :@actor_command_window, :@skill_window, :@item_window,
     :@actor_window, :@enemy_window, :@target_window].each do |var|
      win = scene.instance_variable_get(var) rescue nil
      if window_usable?(win)
        win.close if win.respond_to?(:close)
        win.deactivate if win.respond_to?(:deactivate)
      end
    end

    # 3. 驱动引擎进入标准胜利管线（RGSS3 vs RGSS2）
    if defined?(BattleManager) && BattleManager.respond_to?(:process_victory)
      BattleManager.process_victory
    elsif scene.respond_to?(:process_victory)
      scene.process_victory
    elsif scene.respond_to?(:battle_end)
      scene.battle_end(0)
    end
    true
  ensure
    @resolving_action = false
  end
end
```

### 4.4 一键逃跑（`battle:escape`）

原版逃跑逻辑受 `rand < @escape_ratio` 随机概率制约。一键逃跑必须**100% 强制脱战**，且不扣金钱、不触发惩罚：

```ruby
def execute_battle_escape
  scene = live_battle_scene
  return false unless scene

  # 关闭与取消命令窗口
  [:@party_command_window, :@actor_command_window].each do |var|
    win = scene.instance_variable_get(var) rescue nil
    win.deactivate if window_usable?(win) && win.respond_to?(:deactivate)
  end

  if defined?(BattleManager) && BattleManager.respond_to?(:process_abort)
    # RGSS3: 播放逃跑消息并中止战斗
    if defined?(Vocab::EscapeStart) && defined?($game_party) && defined?($game_message)
      $game_message.add(sprintf(Vocab::EscapeStart, $game_party.name)) rescue nil
    end
    BattleManager.process_abort
    true
  elsif scene.respond_to?(:battle_end)
    # RGSS2: 状态 1 代表逃跑脱战
    scene.battle_end(1)
    true
  else
    false
  end
end
```

### 4.5 一键战败与中止

- **一键战败（`battle:defeat`）**：
  ```ruby
  def execute_battle_defeat
    scene = live_battle_scene
    return false unless scene && defined?($game_party) && $game_party
    $game_party.members.each { |m| m.hp = 0 if m.respond_to?(:hp=) }
    if defined?(BattleManager) && BattleManager.respond_to?(:process_defeat)
      BattleManager.process_defeat
    elsif scene.respond_to?(:battle_end)
      scene.battle_end(2)
    end
    true
  end
  ```
- **中止战斗（`battle:abort`）**：
  ```ruby
  if defined?(BattleManager) && BattleManager.respond_to?(:process_abort)
    BattleManager.process_abort
  elsif live_battle_scene && live_battle_scene.respond_to?(:battle_end)
    live_battle_scene.battle_end(1)
  end
  ```

### 4.6 场景导航与卡死修复动作

- **`fix:map`**：
  ```ruby
  if defined?(SceneManager) && defined?(Scene_Map)
    SceneManager.goto(Scene_Map)
  elsif defined?(Scene_Map)
    $scene = Scene_Map.new
  end
  ```
- **`fix:title`**：
  ```ruby
  if defined?(SceneManager) && defined?(Scene_Title)
    SceneManager.goto(Scene_Title)
  elsif defined?(Scene_Title)
    $scene = Scene_Title.new
  end
  ```
- **`fix:clearEvent`**：
  清空当前卡住的解释器指令列表、移动路线与消息队列：
  ```ruby
  if defined?($game_map) && $game_map
    interp = $game_map.respond_to?(:interpreter) ? $game_map.interpreter : $game_map.instance_variable_get(:@interpreter)
    interp.clear if interp && interp.respond_to?(:clear)
  end
  $game_message.clear if defined?($game_message) && $game_message.respond_to?(:clear)
  $game_player.clear_move_route if defined?($game_player) && $game_player.respond_to?(:clear_move_route)
  ```
- **`fix:clearMoveRoute`**：
  ```ruby
  $game_player.clear_move_route if defined?($game_player) && $game_player.respond_to?(:clear_move_route)
  if defined?($game_map) && $game_map && $game_map.respond_to?(:events)
    $game_map.events.values.each { |ev| ev.clear_move_route if ev.respond_to?(:clear_move_route) }
  end
  ```
- **`fix:closeWindows`**：
  遍历当前场景实例变量，针对所有未销毁的 Window 执行 `close` 与 `deactivate`。
- **`fix:fadeIn`**：
  强制画面淡入：`Graphics.fadein(1) if defined?(Graphics) && Graphics.respond_to?(:fadein)`。
- **场景跳转（`scene:*`）**：
  统一封装 `goto_scene(scene_class)`：
  ```ruby
  def goto_scene(cls)
    if defined?(SceneManager) && SceneManager.respond_to?(:goto)
      SceneManager.goto(cls)
    else
      $scene = cls.new
    end
  end
  ```
  依次分发 `scene:item` (`Scene_Item`), `scene:skill` (`Scene_Skill`), `scene:equip` (`Scene_Equip`), `scene:save` (`Scene_Save`)。

---

## 5. 前端与界面集成

### 5.1 开放动作声明（`supported.ts`）

在 `components/game-edit/supported.ts` 中新增 RGSS 支持的运行动作白名单：

```ts
export const RGSS_SUPPORTED_RUN_ACTIONS: ReadonlySet<RunActionId> = new Set<RunActionId>([
  'battle:victory',
  'battle:escape',
  'battle:defeat',
  'battle:abort',
  'battle:enemyHp1',
  'battle:partyHeal',
  'fix:map',
  'fix:title',
  'fix:clearEvent',
  'fix:clearMoveRoute',
  'fix:closeWindows',
  'fix:fadeIn',
  'scene:item',
  'scene:skill',
  'scene:equip',
  'scene:save',
])
```

### 5.2 浮层与外部控制台解禁

1. **游戏内嵌浮层（`plugins/rgss/src/Workbench.tsx`）**：
   ```diff
   - hideRunTools={true}
   - hideSpeedSliders={true}
   + hideRunTools={false}
   + hideSpeedSliders={false}
   ```
2. **外部 Web 控制台（`components/GameEditPage.tsx`）**：
   ```diff
   - hideRunTools={isRgss}
   - hideSpeedSliders={isRgss}
   + hideRunTools={false}
   + hideSpeedSliders={false}
   ```
3. **动作白名单过滤**：
   在 `GameEditWorkbench.tsx` 与 `GameEditRunSettings.tsx` 中，根据当前引擎传入的 `supportedActions` 进行工具栏按钮的动态渲染过滤。

### 5.3 浮层关闭联动（`runActionNeedsClose`）

触发 `battle:victory`、`battle:escape`、`fix:map`、`fix:title` 等涉及大场景转换或战斗结束动作时，前端浮层立即调用 `onRequestClose()` 归还游戏主画面焦点，确保战后对白或地图刷新直接呈现给玩家。

---

## 6. 验证与测试策略

1. **单元回归测试（Ruby）**：
   - 在 `__tests__/plugins/rgss-edit-runtime.rb` 中新增对 `op: 'moveRate'`、`op: 'gameSpeed'` 与 `op: 'runAction'` 的分发测试；
   - 模拟 RGSS3（`BattleManager` + `SceneManager`）环境：验证 `battle:victory` 正常调用 `process_victory` 并清空输入窗口；
   - 模拟 RGSS2（纯 `$scene = Scene_Battle.new`，无 `BattleManager`）环境：验证 `battle:victory` 正常调用 `scene.process_victory` 或 `scene.battle_end(0)`，证明双引擎兼容无死角。
2. **TypeScript 前端单元测试**：
   - 校验 `RGSS_SUPPORTED_RUN_ACTIONS` 集合定义；
   - 校验 `Workbench.tsx` 与 `GameEditPage.tsx` 在 RGSS 模式下正常渲染速度滑块与运行动作按钮。
3. **真实游戏真机验证**：
   - **RPG Maker VX Ace 游戏**（例如《Rei and the Floating City》）：
     1. 大地图开启 2x / 3x 倍速，验证行走平滑度与随从紧密跟随；
     2. 野外遇敌或公共事件切入战斗，在指令输入阶段点击“一键胜利”，确认战后结算正常展开且无残留窗口焦点；
     3. 验证“一键逃跑”100% 成功脱离战斗。
   - **RPG Maker VX 游戏**（纯 RGSS2 工程）：
     1. 验证速度滑块调速与人物移动加速；
     2. 战斗中验证一键胜利顺利结算回地图，无常量未定义崩溃。
