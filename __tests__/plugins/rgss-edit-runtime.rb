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
  def auto_battle?; false; end
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

%w[through encounter menuEnabled saveEnabled clickMove alwaysDash autotalk autoBattle autoWin].each do |key|
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
bridge.apply({ 'op' => 'runFlag', 'key' => 'autoBattle', 'value' => false })
check(!$game_actors[1].auto_battle?, 'disabling autoBattle did not restore default auto battle')
bridge.apply({ 'op' => 'runFlag', 'key' => 'autoBattle', 'value' => true })

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
$game_troop = Struct.new(:members).new([MockEnemy.new])
BattleManager.instance_variable_set(:@phase, :turn)
runtime.instance_variable_set(:@hooks_installed, false)
runtime.ensure_hooks
check(BattleManager.judge_win_loss == :victory, 'autoWin did not trigger victory')
check($game_troop.members.first.hp == 0, 'autoWin did not reduce enemy hp to 0')

class Scene_Battle; end
module SceneManager
  def self.scene; @scene; end
end
SceneManager.instance_variable_set(:@scene, Scene_Battle.new)
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

puts 'RGSS edit runtime assertions passed'
