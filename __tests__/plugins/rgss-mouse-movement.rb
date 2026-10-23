require 'ostruct'

def check(condition, message)
  raise "Assertion failed: #{message}" unless condition
end

# 1. Mock native mkxp-z Input module
module Input
  MOUSELEFT = 1
  UP = 2
  DOWN = 3
  LEFT = 4
  RIGHT = 5

  @pressed_keys = {}
  @triggered_keys = {}
  @mouse_x = 0
  @mouse_y = 0

  class << self
    attr_accessor :mouse_x, :mouse_y, :pressed_keys, :triggered_keys

    def press?(key)
      !!@pressed_keys[key]
    end

    def trigger?(key)
      !!@triggered_keys[key]
    end
  end
end

# 2. Preload aliases raw methods
if defined?(Input)
  class << Input
    alias_method :chaya_raw_press?, :press? unless method_defined?(:chaya_raw_press?)
    alias_method :chaya_raw_trigger?, :trigger? unless method_defined?(:chaya_raw_trigger?)
  end
end

module ChayaRGSS
  class Function
    def initialize(&block); @implementation = block; end
    def call(*args); @implementation.call(*args); end
  end
  def self.function(&block); Function.new(&block); end
end

require_relative '../../plugins/rgss/user32'
require_relative '../../plugins/rgss/mouse_movement'

# 3. Simulate UniversalMouse overriding Input
module UniversalMouse
  @@input_table = {}
  def self.set_table(key, val)
    @@input_table[key] = val
  end
  def self.table
    @@input_table
  end
end

class << Input
  alias_method :__Mouse__press?, :press?
  alias_method :__Mouse__trigger?, :trigger?

  def press?(sym)
    return UniversalMouse.table[sym] ? true : false
  end

  def trigger?(sym)
    return UniversalMouse.table[sym] == 0 ? true : false
  end
end

# 4. Verify GetAsyncKeyState uses raw input despite UniversalMouse override
get_async_key = ChayaRGSS.user32('GetAsyncKeyState')
Input.pressed_keys[Input::MOUSELEFT] = false
check(get_async_key.call(1) == 0, 'mouse unpressed must return 0')
Input.pressed_keys[Input::MOUSELEFT] = true
check(get_async_key.call(1) == 0x8000, 'mouse pressed must return 0x8000 via raw input')

# 5. Test script_patches patch logic for UniversalMouse
raw_source = <<~RUBY
  module InputMouse
  end
  module Input
    def self.press?(sym)
      return @@input_table[sym] ? true : false
    end
    def self.trigger?(sym)
      return @@input_table[sym] == 0 ? true : false
    end
    def self.update_input_table_c_move
      @@cmove_c_enable = true
    end
  end
RUBY

$RGSS_SCRIPTS = [[1, 'UniversalMouse', nil, raw_source]]
require_relative '../../plugins/rgss/script_patches'
patched = $RGSS_SCRIPTS[0][3]
check(patched.include?('respond_to?(:__Mouse__press?)'), 'script_patches must add fallback for press?')
check(patched.include?('respond_to?(:__Mouse__trigger?)'), 'script_patches must add fallback for trigger?')
check(patched.include?("def self.update_input_table_c_move\n    return"), 'script_patches must disable c_move')

# 6. Test MouseMovement under simulated Scene_Map
class MockMap
  attr_accessor :width, :height, :display_x, :display_y
  def initialize
    @width = 20
    @height = 15
    @display_x = 0
    @display_y = 0
  end
  def loop_horizontal?; false; end
  def loop_vertical?; false; end
  def adjust_x(x); x - @display_x; end
  def adjust_y(y); y - @display_y; end
end

class MockPlayer
  attr_accessor :x, :y, :direction, :moving
  def initialize
    @x = 5
    @y = 5
    @direction = 2
    @moving = false
  end
  def moving?; @moving; end
  def movable?; true; end
  def passable?(x, y, d)
    true
  end
  def move_straight(d)
    @direction = d
    case d
    when 2 then @y += 1
    when 4 then @x -= 1
    when 6 then @x += 1
    when 8 then @y -= 1
    end
  end
end

$game_map = MockMap.new
$game_player = MockPlayer.new
$game_message = OpenStruct.new(:busy? => false)

module SceneManager
  def self.scene_is?(scene); true; end
end
class Scene_Map; end

# Test screen_to_map coordinate conversion
coords = ChayaRGSS::MouseMovement.screen_to_map(64, 96)
check(coords == [2, 3], "screen_to_map coords mismatch: #{coords.inspect}")

# Test mouse click trigger pathfinding
Input.mouse_x = 64 # tile 2
Input.mouse_y = 64 # tile 2
Input.pressed_keys[Input::MOUSELEFT] = false
ChayaRGSS::MouseMovement.update
Input.pressed_keys[Input::MOUSELEFT] = true
ChayaRGSS::MouseMovement.update

check(ChayaRGSS::MouseMovement.active, 'MouseMovement should be active after left click')
check(ChayaRGSS::MouseMovement.target_x == 2 && ChayaRGSS::MouseMovement.target_y == 2, 'target coordinates should match click')

# Release click and step player towards target
Input.pressed_keys[Input::MOUSELEFT] = false
10.times do
  ChayaRGSS::MouseMovement.update
  break unless ChayaRGSS::MouseMovement.active
end
check(!ChayaRGSS::MouseMovement.active, 'MouseMovement should finish when reaching target')
check($game_player.x == 2 && $game_player.y == 2, "player should have moved to (2, 2), now at (#{$game_player.x}, #{$game_player.y})")

# Test dialog blocking mouse movement
$game_message = OpenStruct.new(:busy? => true)
Input.mouse_x = 96
Input.mouse_y = 96
Input.pressed_keys[Input::MOUSELEFT] = false
ChayaRGSS::MouseMovement.update
Input.pressed_keys[Input::MOUSELEFT] = true
ChayaRGSS::MouseMovement.update
check(!ChayaRGSS::MouseMovement.active, 'MouseMovement must not trigger while message is busy')

# Test holding mouse down and dynamic cursor following (matching RPG Maker MV TouchInput)
$game_message = OpenStruct.new(:busy? => false)
$game_player.x = 2
$game_player.y = 2
Input.mouse_x = 96 # tile 3
Input.mouse_y = 64 # tile 2
Input.pressed_keys[Input::MOUSELEFT] = false
ChayaRGSS::MouseMovement.update
Input.pressed_keys[Input::MOUSELEFT] = true
ChayaRGSS::MouseMovement.update
check(ChayaRGSS::MouseMovement.active, 'MouseMovement should activate on click')
check(ChayaRGSS::MouseMovement.target_x == 3 && ChayaRGSS::MouseMovement.target_y == 2, 'target should be (3, 2)')

# Keep mouse pressed for 15 frames while moving the cursor to tile 5, 2
15.times do |i|
  Input.mouse_x = 160 if i >= 12 # tile 5
  ChayaRGSS::MouseMovement.update
end
check(ChayaRGSS::MouseMovement.active, 'MouseMovement should remain active while holding')
check(ChayaRGSS::MouseMovement.target_x == 5 && ChayaRGSS::MouseMovement.target_y == 2, 'target should dynamically update to (5, 2) when dragged')

# Release mouse and step to destination
Input.pressed_keys[Input::MOUSELEFT] = false
10.times do
  ChayaRGSS::MouseMovement.update
  break unless ChayaRGSS::MouseMovement.active
end
check(!ChayaRGSS::MouseMovement.active, 'MouseMovement should finish when reaching final target after release')
check($game_player.x == 5 && $game_player.y == 2, "player should have moved to (5, 2), now at (#{$game_player.x}, #{$game_player.y})")

puts 'RGSS mouse movement unit tests passed'
