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
def $game_map.loop_horizontal?; false; end
def $game_map.loop_vertical?; false; end
def $game_map.adjust_x(x); x - @display_x; end
def $game_map.adjust_y(y); y - @display_y; end
def $game_map.round_x_with_direction(x, d); x + (d == 6 ? 1 : d == 4 ? -1 : 0); end
def $game_map.round_y_with_direction(y, d); y + (d == 2 ? 1 : d == 8 ? -1 : 0); end
def $game_map.valid?(x, y); x >= 0 && x < 20 && y >= 0 && y < 15; end

$game_player = OpenStruct.new(:x => 2, :y => 3)
def $game_player.moving?; false; end
def $game_player.passable?(x, y, d); true; end
def $game_player.move_straight(d); @moved_dir = d; end

# Test screen_to_map
coords = mm.screen_to_map(64, 96) # tile (2, 3) at 32px
check(coords == [2, 3], "expected [2, 3] but got #{coords.inspect}")

# Test find_path (A*)
path = mm.find_path(2, 3, 5, 3) # move right (6, 6, 6)
check(path == [6, 6, 6], "expected [6, 6, 6] but got #{path.inspect}")

path = mm.find_path(2, 3, 2, 5) # move down (2, 2)
check(path == [2, 2], "expected [2, 2] but got #{path.inspect}")

path = mm.find_path(2, 3, 2, 1) # move up (8, 8)
check(path == [8, 8], "expected [8, 8] but got #{path.inspect}")

path = mm.find_path(2, 3, 0, 3) # move left (4, 4)
check(path == [4, 4], "expected [4, 4] but got #{path.inspect}")

# Test interrupt
mm.target_x = 5
mm.target_y = 5
mm.active = true
mm.interrupt
check(!mm.active && mm.target_x == nil, "interrupt should clear target and active")

puts "RGSS mouse movement unit tests passed"

