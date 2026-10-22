
require 'ostruct'
require_relative '../../plugins/rgss/mouse_movement'

def check(value, msg)
  raise msg unless value
end

mm = ChayaRGSS::MouseMovement

# 1. Reset / Active state
mm.reset
check(!mm.active, "should not be active initially")

# 2. screen_to_map without map
check(mm.screen_to_map(100, 100) == nil, "should return nil when not on map")

# 3. Simulate on map
$game_map = OpenStruct.new(:display_x => 0, :display_y => 0, :width => 20, :height => 15)
$game_player = OpenStruct.new(:x => 2, :y => 3)
def $game_player.moving?; false; end
def $game_player.passable?(x, y, d); true; end
def $game_player.move_straight(d); @moved_dir = d; end

# Test screen_to_map
coords = mm.screen_to_map(64, 96) # tile (2, 3) at 32px
check(coords == [2, 3], "expected [2, 3] but got #{coords.inspect}")

# Test next_direction
dir = mm.next_direction(2, 3, 5, 3) # move right (6)
check(dir == 6, "expected 6 (Right) but got #{dir}")

dir = mm.next_direction(2, 3, 2, 7) # move down (2)
check(dir == 2, "expected 2 (Down) but got #{dir}")

dir = mm.next_direction(2, 3, 2, 1) # move up (8)
check(dir == 8, "expected 8 (Up) but got #{dir}")

dir = mm.next_direction(2, 3, 0, 3) # move left (4)
check(dir == 4, "expected 4 (Left) but got #{dir}")

# Test interrupt
mm.target_x = 5
mm.target_y = 5
mm.active = true
mm.interrupt
check(!mm.active && mm.target_x == nil, "interrupt should clear target and active")

puts "RGSS mouse movement unit tests passed"

