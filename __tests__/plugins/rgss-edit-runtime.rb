require_relative 'rgss-runtime'
require_relative '../../plugins/rgss/mouse_movement'

class VxEditActor
  attr_accessor :name, :level, :exp, :hp, :mp, :maxhp, :maxmp, :atk, :def, :spi, :agi, :class_id
  attr_reader :skills, :states
  def initialize
    @name, @level, @exp = 'Hero', 1, 0
    @hp, @maxhp, @mp, @maxmp = 50, 100, 10, 30
    @atk, @def, @spi, @agi, @class_id = 10, 10, 10, 10, 1
    @skills, @states = [], []
  end
  def change_level(value, _show); @level = value; end
  def change_exp(value, _show); @exp = value; end
  def learn_skill(id); @skills |= [id]; end
  def forget_skill(id); @skills -= [id]; end
  def add_state(id); @states |= [id]; end
  def remove_state(id); @states -= [id]; end
  # Match WFRGSS AutoBattle: optional arg, callers use auto_battle?(false).
  def auto_battle?(action = true); false; end
end

class VxEditParty
  attr_reader :gold
  def initialize; @gold, @items = 100, {}; end
  def gain_gold(delta); @gold += delta; end
  def item_number(item); @items[item.id] || 0; end
  def gain_item(item, delta); @items[item.id] = item_number(item) + delta; end
end

class AceEditActor < VxEditActor
  attr_reader :param_changes
  def initialize
    super
    @param_changes = []
  end
  def mhp; @maxhp; end
  def mmp; @maxmp; end
  def mat; @spi; end
  def mdf; @spi; end
  def luk; 10; end
  def add_param(index, delta)
    @param_changes << [index, delta]
    field = [:maxhp, :maxmp, :atk, :def, :spi, :spi, :agi][index]
    public_send("#{field}=", public_send(field) + delta)
  end
  def change_class(id); @class_id = id; end
end

class MockRealGamePlayer
  attr_reader :through
  attr_accessor :x, :y, :direction
  def initialize
    @through = false
    @x, @y, @direction = 0, 0, 2
  end
  def dash?
    false
  end
end

$game_party = VxEditParty.new
$game_player = MockRealGamePlayer.new
$game_system = Struct.new(:encounter_disabled, :menu_disabled, :save_disabled).new(false, false, false)
$game_actors = { 1 => VxEditActor.new }
$data_classes = [nil, OpenStruct.new(:id => 1, :name => 'Fighter'), OpenStruct.new(:id => 2, :name => 'Mage')]
$game_variables, $game_switches = [nil, 0], [nil, false]
bridge = ChayaRGSS::Bridge
runtime = ChayaRGSS::EditRuntime

%w[through encounter menuEnabled saveEnabled clickMove alwaysDash autotalk autoBattle autoWin skipBattleResult].each do |key|
  [true, false, true].each do |value|
    fields = bridge.apply({ 'op' => 'runFlag', 'key' => key, 'value' => value })
    check(fields == ["runFlag:#{key}"], "wrong acknowledgement for #{key}")
    check(bridge.full_session_state['session'][key] == value, "flag #{key} did not round trip")
  end
end
check($game_player.through && !$game_system.menu_disabled, 'flags did not reach the game objects')

runtime.ensure_hooks
check($game_player.dash?, 'alwaysDash did not make player dash')
bridge.apply({ 'op' => 'runFlag', 'key' => 'alwaysDash', 'value' => false })
check(!$game_player.dash?, 'disabling alwaysDash did not restore default player dash')
bridge.apply({ 'op' => 'runFlag', 'key' => 'alwaysDash', 'value' => true })

check($game_actors[1].auto_battle?, 'autoBattle did not make actor auto battle')
check($game_actors[1].auto_battle?(false), 'autoBattle(false) arity broke under autoBattle flag')
bridge.apply({ 'op' => 'runFlag', 'key' => 'autoBattle', 'value' => false })
check(!$game_actors[1].auto_battle?, 'disabling autoBattle did not restore default auto battle')
check(!$game_actors[1].auto_battle?(false), 'auto_battle?(false) should forward after disable')
bridge.apply({ 'op' => 'runFlag', 'key' => 'autoBattle', 'value' => true })

class Rect
  attr_accessor :x, :y, :width, :height
  def initialize; @x = @y = @width = @height = 0; end
end
class Window_Selectable
  attr_accessor :index
  def initialize
    @index = 0
  end
  def col_max; 0; end
  def item_max; 0; end
  def width; 100; end
  def standard_padding; 12; end
  def spacing; 8; end
  def item_height; 24; end
  def item_width; (width - standard_padding * 2 + spacing) / col_max - spacing; end
  def row_max; [(item_max + col_max - 1) / col_max, 1].max; end
  def row; index / col_max; end
  def item_rect(index)
    rect = Rect.new
    rect.width = item_width
    rect.height = item_height
    rect.x = index % col_max * (item_width + spacing)
    rect.y = index / col_max * item_height
    rect
  end
end
runtime.install_selectable_hook
empty = Window_Selectable.new
check(empty.chaya_safe_col_max == 1, 'safe col_max must coerce empty lists to 1')
check(empty.row == 0, 'row must not divide by zero when col_max is 0')
check(empty.row_max == 1, 'row_max must not divide by zero when col_max is 0')
check(empty.item_width.is_a?(Numeric), 'item_width must not divide by zero when col_max is 0')
check(empty.item_rect(0).y == 0, 'item_rect must not divide by zero when col_max is 0')

class Scene_Battle
  attr_accessor :enemy_window
  def initialize
    @enemy_window = OpenStruct.new(:enemy => nil)
  end
  def on_enemy_ok
    BattleManager.actor.input.target_index = @enemy_window.enemy.index
  end
  def on_enemy_cancel
    @cancelled = true
  end
  def cancelled?; @cancelled; end
end
module BattleManager
  def self.actor; nil; end
end
runtime.install_battle_command_guards
guarded = Scene_Battle.new
guarded.on_enemy_ok
check(guarded.cancelled?, 'on_enemy_ok must cancel when enemy/actor is missing')
check(!runtime.battle_result_context?, 'result mash must stay off outside MOG result flags')
$game_temp = OpenStruct.new(:battle_end => true, :result => true)
check(runtime.battle_result_context?, 'result mash must arm when MOG result flags are set')
$game_temp = OpenStruct.new(:battle_end => false, :result => false)

module BattleManager
  class << self
    def judge_win_loss; false; end
    def process_victory; :victory; end
  end
end
class MockEnemy
  attr_accessor :hp
  def initialize; @hp = 50; end
end
class Scene_Battle; end
module SceneManager
  def self.scene; @scene; end
end
$game_troop = Struct.new(:members).new([MockEnemy.new])
SceneManager.instance_variable_set(:@scene, Scene_Battle.new)
BattleManager.instance_variable_set(:@phase, :init)
runtime.instance_variable_set(:@hooks_installed, false)
runtime.instance_variable_set(:@auto_win_scene, nil)
runtime.ensure_hooks
check(BattleManager.judge_win_loss == false, 'autoWin must not win during battle init')
BattleManager.instance_variable_set(:@phase, :turn)
check(BattleManager.judge_win_loss == :victory, 'autoWin did not trigger victory')
check($game_troop.members.first.hp == 0, 'autoWin did not reduce enemy hp to 0')

module BattleManager
  class << self
    attr_accessor :victory_calls, :fail_victory
    def process_victory
      @victory_calls = (@victory_calls || 0) + 1
      raise 'victory recursively reentered' if @victory_calls > 1
      ChayaRGSS::EditRuntime.tick
      raise 'nested judge must defer victory' unless judge_win_loss == false
      raise 'victory effect failed' if @fail_victory
      @phase = :battle_end
      :victory
    end
  end
end
[:tick, :judge].each do |entry|
  SceneManager.instance_variable_set(:@scene, Scene_Battle.new)
  runtime.instance_variable_set(:@auto_win_scene, nil)
  $game_troop.members.first.hp = 50
  BattleManager.victory_calls = 0
  BattleManager.instance_variable_set(:@phase, :turn)
  if entry == :tick
    runtime.tick
  else
    check(BattleManager.judge_win_loss == :victory, 'judge victory result changed')
  end
  check(BattleManager.victory_calls == 1, "#{entry} must settle victory once during nested updates")
  runtime.tick
  check(BattleManager.victory_calls == 1, 'finished battle settled twice')
end
SceneManager.instance_variable_set(:@scene, Scene_Battle.new)
runtime.instance_variable_set(:@auto_win_scene, nil)
$game_troop.members.first.hp = 50
BattleManager.victory_calls = 0
BattleManager.fail_victory = true
BattleManager.instance_variable_set(:@phase, :turn)
begin
  runtime.tick
  raise 'victory failure was swallowed'
rescue RuntimeError => error
  check(error.message == 'victory effect failed', 'unexpected victory error')
end
BattleManager.fail_victory = false
BattleManager.victory_calls = 0
runtime.tick
check(BattleManager.victory_calls == 1, 'victory guard remained locked after an error')
SceneManager.instance_variable_set(:@scene, nil)

ChayaRGSS::MouseMovement.active = true
bridge.apply({ 'op' => 'runFlag', 'key' => 'clickMove', 'value' => false })
check(!ChayaRGSS::MouseMovement.active, 'disabling click move must cancel its active path')
module Input
  MOUSELEFT = 1
  def self.trigger?(_key); raise 'disabled click movement read mouse input'; end
end
ChayaRGSS::MouseMovement.update
bridge.apply({ 'op' => 'runFlag', 'key' => 'clickMove', 'value' => true })

bridge.apply({ 'op' => 'count', 'kind' => 'item', 'id' => 1, 'value' => 12 })
check(bridge.full_session_state['session']['counts']['item:1'] == 12, 'VX inventory requires no all_items method')
bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'mhp' => 250, 'mmp' => 90, 'mat' => 35, 'exp' => 1234, 'classId' => 2, 'hp' => 200 } })
hero = bridge.full_session_state['session']['actors'][1]
check(hero['mhp'] == 250 && hero['mmp'] == 90 && hero['mat'] == 35 && hero['mdf'] == 35, 'VX parameter aliases failed')
check(hero['exp'] == 1234 && hero['classId'] == 2 && hero['hp'] == 200, 'VX actor values did not round trip')
bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'hp' => 10_000, 'mp' => 10_000 } })
check($game_actors[1].hp == 250 && $game_actors[1].mp == 90, 'VX vitals must clamp to maxhp/maxmp')
bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'hp' => 0, 'mp' => 0 } })
check($game_actors[1].hp == 0 && $game_actors[1].mp == 0, 'zero vitals must remain editable')
begin
  bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'luk' => 100 } })
  raise 'unsupported VX actor field falsely reported success'
rescue RuntimeError => error
  check(error.message.include?('unsupported by this game'), 'unsupported fields need an explicit error')
end
$game_actors[1] = AceEditActor.new
bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'mhp' => 300, 'atk' => 80, 'classId' => 2 } })
check($game_actors[1].param_changes == [[0, 200], [2, 70]], 'VX Ace parameters must use add_param with the current-value delta')
check($game_actors[1].class_id == 2, 'VX Ace change_class was not used')
bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'hp' => 10_000, 'mp' => 10_000 } })
check($game_actors[1].hp == 300 && $game_actors[1].mp == 30, 'Ace vitals must clamp to mhp/mmp')
[-1, 1.5, '100'].each do |invalid|
  begin
    bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'hp' => invalid } })
    raise 'invalid vital falsely accepted'
  rescue RuntimeError => error
    check(error.message == 'Expected non-negative integer', 'invalid vitals must still be rejected')
  end
end

lock_ops = [
  { 'op' => 'goldLock', 'value' => 500 },
  { 'op' => 'varLock', 'id' => 1, 'value' => 42 },
  { 'op' => 'swLock', 'id' => 1, 'value' => 1 },
  { 'op' => 'countLock', 'kind' => 'item', 'id' => 1, 'value' => 8 },
  { 'op' => 'actorVitalLock', 'actorId' => 1, 'kind' => 'hp', 'value' => 70 },
  { 'op' => 'actorOwnedLock', 'actorId' => 1, 'kind' => 'skills', 'entryId' => 3, 'owned' => true },
  { 'op' => 'actorOwnedLock', 'actorId' => 1, 'kind' => 'states', 'entryId' => 4, 'owned' => false }
]
lock_ops.each { |op| check(bridge.apply(op.merge('on' => true)).first.start_with?('lock:'), 'lock acknowledgement mismatch') }
$game_party.gain_gold(-100)
$game_party.gain_item($data_items[1], -2)
$game_variables[1], $game_switches[1], $game_actors[1].hp = 0, false, 1
$game_actors[1].forget_skill(3)
$game_actors[1].add_state(4)
runtime.tick
check($game_party.gold == 500 && $game_party.item_number($data_items[1]) == 8, 'party locks were not enforced')
check($game_variables[1] == 42 && $game_switches[1] && $game_actors[1].hp == 70, 'variable, switch or vital locks were not enforced')
check($game_actors[1].skills.include?(3) && !$game_actors[1].states.include?(4), 'owned locks were not enforced')
bridge.apply({ 'op' => 'gold', 'value' => 600 })
bridge.apply({ 'op' => 'actor', 'id' => 1, 'patch' => { 'hp' => 90, 'skillIds' => [] } })
runtime.tick
check($game_party.gold == 600 && $game_actors[1].hp == 90 && $game_actors[1].skills.empty?, 'panel edits must update existing locks')
check(bridge.full_session_state['session']['locks']['gold:0'] == 600, 'lock targets did not round trip')
lock_ops.each { |op| bridge.apply(op.merge('on' => false)) }
$game_variables[1] = 7
runtime.tick
check($game_variables[1] == 7 && runtime.lock_values.empty?, 'unlock did not release values')

bridge.receive_from_webview({ 'type' => 'edit.cmd', 'op' => 'sw', 'id' => 1, 'value' => false, 'cmdId' => 'switch-edit' })
offset = ChayaRGSS::NativeWebview.out.size
bridge.pump
replies = ChayaRGSS::NativeWebview.out.drop(offset)
check(replies.any? { |text| text.include?('switch-edit') && text.include?('true') }, 'command acknowledgement missing')
check(replies.any? { |text| text.include?('edit.state') }, 'writes must immediately publish the resulting state')
bridge.apply({ 'op' => 'goldLock', 'on' => true, 'value' => 500 })
$game_party = VxEditParty.new
runtime.tick
check($game_party.gold == 100 && runtime.lock_values.empty?, 'locks leaked into a loaded save or new game')

# Test gameSpeed, walkRate, runRate, moveRate
bridge.apply({ 'op' => 'gameSpeed', 'value' => 2.5 })
check(runtime.game_speed == 2.5, 'game_speed not set')
check(bridge.full_session_state['session']['gameSpeed'] == 2.5, 'gameSpeed not in session state')

bridge.apply({ 'op' => 'moveRate', 'value' => 2.0 })
check(runtime.walk_rate == 2.0 && runtime.run_rate == 2.0, 'moveRate did not update both rates')
check(bridge.full_session_state['session']['walkRate'] == 2.0, 'walkRate not in session state')
check(bridge.full_session_state['session']['runRate'] == 2.0, 'runRate not in session state')

bridge.apply({ 'op' => 'walkRate', 'value' => 1.5 })
check(runtime.walk_rate == 1.5 && runtime.run_rate == 2.0, 'walkRate updated runRate unexpectedly')

bridge.apply({ 'op' => 'runRate', 'value' => 3.0 })
check(runtime.walk_rate == 1.5 && runtime.run_rate == 3.0, 'runRate updated walkRate unexpectedly')

# Test movement hook scaling
class Game_CharacterBase
  def distance_per_frame; 4.0; end
  def dash?; false; end
end
class Game_Player < Game_CharacterBase
end
runtime.instance_variable_set(:@movement_hooks_installed, false)
runtime.install_movement_hooks
test_player = Game_Player.new
check(test_player.distance_per_frame == 4.0 * 1.5, 'distance_per_frame did not scale by walk_rate')

# Test follower without dash? method does not crash and syncs with player dash
class Game_Follower < Game_CharacterBase
end
bridge.apply({ 'op' => 'runFlag', 'key' => 'alwaysDash', 'value' => false })
$game_player = test_player
test_follower = Game_Follower.new
check(test_follower.distance_per_frame == 4.0 * 1.5, 'follower distance_per_frame did not scale by walk_rate')
test_player.define_singleton_method(:dash?) { true }
check(test_follower.distance_per_frame == 4.0 * 3.0, 'follower distance_per_frame did not scale by run_rate when player dashes')
test_player.define_singleton_method(:dash?) { false }

# Test runAction: battle:victory in RGSS3 (BattleManager)
SceneManager.instance_variable_set(:@scene, Scene_Battle.new)
$game_troop = Struct.new(:members).new([MockEnemy.new])
$game_party = Struct.new(:members).new([VxEditActor.new])
BattleManager.victory_calls = 0
BattleManager.instance_variable_set(:@phase, :turn)
fields = bridge.apply({ 'op' => 'runAction', 'id' => 'battle:victory' })
check(fields == ['runAction:battle:victory'], 'wrong reply for battle:victory')
check($game_troop.members.first.hp == 0, 'battle:victory did not zero enemy hp')
check(BattleManager.victory_calls == 1, 'battle:victory did not invoke process_victory')
check(runtime.instance_variable_get(:@auto_win_scene) == SceneManager.scene, 'battle:victory did not record @auto_win_scene')
runtime.set_run_flag('autoWin', true)
check(!runtime.auto_win_ready?, 'auto_win_ready? should be suppressed for current victory scene')
runtime.set_run_flag('autoWin', false)

# Test runAction: battle:enemyHp1 & partyHeal
$game_troop.members.first.hp = 100
bridge.apply({ 'op' => 'runAction', 'id' => 'battle:enemyHp1' })
check($game_troop.members.first.hp == 1, 'battle:enemyHp1 did not set enemy hp to 1')

$game_party.members.first.hp = 5
bridge.apply({ 'op' => 'runAction', 'id' => 'battle:partyHeal' })
check($game_party.members.first.hp == 100, 'battle:partyHeal did not recover party hp')

# Test runAction: battle:escape in RGSS3
BattleManager.define_singleton_method(:process_abort) { @aborted = true }
bridge.apply({ 'op' => 'runAction', 'id' => 'battle:escape' })
check(BattleManager.instance_variable_get(:@aborted) == true, 'battle:escape did not trigger abort')

# Test runAction: battle:defeat in RGSS3
BattleManager.define_singleton_method(:process_defeat) { @defeated = true }
bridge.apply({ 'op' => 'runAction', 'id' => 'battle:defeat' })
check(BattleManager.instance_variable_get(:@defeated) == true, 'battle:defeat did not trigger defeat')
check($game_party.members.first.hp == 0, 'battle:defeat did not zero party hp')

# Test runAction: fix actions
class Scene_Map; end
class Scene_Title; end
class Scene_Item; end
SceneManager.define_singleton_method(:goto) { |cls| @current_target = cls }
bridge.apply({ 'op' => 'runAction', 'id' => 'fix:map' })
check(SceneManager.instance_variable_get(:@current_target) == Scene_Map, 'fix:map failed')
bridge.apply({ 'op' => 'runAction', 'id' => 'fix:title' })
check(SceneManager.instance_variable_get(:@current_target) == Scene_Title, 'fix:title failed')
bridge.apply({ 'op' => 'runAction', 'id' => 'scene:item' })
check(SceneManager.instance_variable_get(:@current_target) == Scene_Item, 'scene:item failed')

# Test RGSS2 mode (no BattleManager, scene handles battle_end)
class VxSceneBattle < Scene_Battle
  attr_reader :end_result
  def battle_end(res)
    @end_result = res
  end
end
vx_scene = VxSceneBattle.new
SceneManager.instance_variable_set(:@scene, vx_scene)
Object.send(:remove_const, :BattleManager) if defined?(BattleManager)

$game_troop.members.first.hp = 80
runtime.execute_battle_victory
check(vx_scene.end_result == 0, 'RGSS2 victory did not call battle_end(0)')
check($game_troop.members.first.hp == 0, 'RGSS2 victory did not zero enemy hp')

runtime.execute_battle_escape
check(vx_scene.end_result == 1, 'RGSS2 escape did not call battle_end(1)')

runtime.execute_battle_defeat
check(vx_scene.end_result == 2, 'RGSS2 defeat did not call battle_end(2)')

# Test RGSS2 update_move hook
class VxCharacter
  attr_accessor :x, :y, :real_x, :real_y, :move_speed, :dash, :anime_count
  def initialize
    @x = 5; @y = 5; @real_x = 4 * 256; @real_y = 5 * 256; @move_speed = 4; @dash = false; @anime_count = 0
  end
  def update_move
    distance = 2 ** @move_speed
    distance *= 2 if @dash
    @real_x = [@real_x - distance, @x * 256].max if @x * 256 < @real_x
    @real_x = [@real_x + distance, @x * 256].min if @x * 256 > @real_x
    @real_y = [@real_y - distance, @y * 256].max if @y * 256 < @real_y
    @real_y = [@real_y + distance, @y * 256].min if @y * 256 > @real_y
    @anime_count += 1
  end
end
class VxPlayer < VxCharacter
  def dash?; false; end
end
Object.send(:remove_const, :Game_CharacterBase) if defined?(Game_CharacterBase)
Object.const_set(:Game_Character, VxCharacter)
Object.send(:remove_const, :Game_Player) if defined?(Game_Player)
Object.const_set(:Game_Player, VxPlayer)
runtime.instance_variable_set(:@movement_hooks_installed, false)
runtime.install_movement_hooks
vx_player = VxPlayer.new
vx_player.update_move
check(vx_player.real_x == 4 * 256 + 24, "RGSS2 update_move did not scale by walk_rate: #{vx_player.real_x}")

# Restore BattleManager for any subsequent suites
module BattleManager
  def self.actor; nil; end
end

puts 'RGSS edit runtime assertions passed'

