
require 'ostruct'

module Graphics
  def self.width; 544; end
  def self.height; 416; end
end

require_relative '../../plugins/rgss/mouse_movement'

def check(val, msg)
  raise msg unless val
end

mm = ChayaRGSS::MouseMovement

# Test A* on simple grid
# Map size: 5x5, with a wall at (1, 1), (1, 2), (1, 3)
# Start: (0, 2), Goal: (2, 2)
# Needs to walk around wall: (0,2) -> (0,0) -> (2,0) -> (2,2) or (0,4) -> (2,4) -> (2,2)

map = OpenStruct.new(
  :width => 5,
  :height => 5,
  :display_x => 0,
  :display_y => 0,
  :map_id => 1
)
def map.loop_horizontal?; false; end
def map.loop_vertical?; false; end
def map.round_x(x); x; end
def map.round_y(y); y; end
def map.round_x_with_direction(x, d); x + (d == 6 ? 1 : d == 4 ? -1 : 0); end
def map.round_y_with_direction(y, d); y + (d == 2 ? 1 : d == 8 ? -1 : 0); end
def map.valid?(x, y); x >= 0 && x < 5 && y >= 0 && y < 5; end
def map.adjust_x(x); x - @display_x; end
def map.adjust_y(y); y - @display_y; end
def map.events; {}; end

$game_map = map

player = OpenStruct.new(:x => 0, :y => 2)
def player.moving?; false; end
def player.passable?(x, y, d)
  nx = $game_map.round_x_with_direction(x, d)
  ny = $game_map.round_y_with_direction(y, d)
  return false unless $game_map.valid?(nx, ny)
  # Wall at x=1, y=1..3
  return false if nx == 1 && (1..3).include?(ny)
  true
end
$game_player = player

path = mm.find_path(0, 2, 2, 2)
check(path != nil, "A* path should not be nil")
check(path.size > 0, "A* path should find steps around wall")
puts "A* found steps: #{path.inspect}"

# Follow path simulation
cx, cy = 0, 2
path.each do |d|
  check(player.passable?(cx, cy, d), "Step #{d} from (#{cx},#{cy}) must be passable")
  cx = map.round_x_with_direction(cx, d)
  cy = map.round_y_with_direction(cy, d)
end
check(cx == 2 && cy == 2, "Path must reach goal (2, 2), reached (#{cx}, #{cy})")

puts "A* unit tests passed!"

