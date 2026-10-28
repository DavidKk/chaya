require 'tmpdir'
require 'fileutils'
require 'json'
require 'thread'

module Graphics
  def self.frame_count; 123; end
  def self.update; end
  def self.width; 544; end
  def self.height; 416; end
  def self.display_width; 1920; end
  def self.display_height; 1080; end
end

module Input
  MOUSELEFT = 1
  def self.press?(_key); true; end
  def self.trigger?(_key); true; end
  def self.repeat?(_key); true; end
  def self.dir4; 4; end
  def self.dir8; 7; end
  def self.mouse_x; 120; end
  def self.mouse_y; 80; end
end
require_relative '../../plugins/rgss/input'

module ChayaRGSS
  class Function
    def initialize(&block); @impl = block; end
    def call(*args); @impl.call(*args); end
  end
  def self.function(&block); Function.new(&block); end

  module NativeWebview
    def self.start; end
    def self.pump; end
    def self.ready?; true; end
    def self.eval_js(source); (@out ||= []) << source; end
    def self.out; @out || []; end
  end
end

$LOADED_FEATURES << File.expand_path('../../plugins/rgss/native_webview.rb', __dir__)
require_relative '../../plugins/rgss/bridge'
require_relative '../../plugins/rgss/user32'

def check(val, msg)
  raise msg unless val
end

# 1. Test GetClientRect always returning Graphics.width/height
buf = ' ' * 16
fn = ChayaRGSS.user32('GetClientRect')
fn.call(42, buf)
vals = buf.unpack('l4')
check(vals == [0, 0, 544, 416], "GetClientRect expected [0, 0, 544, 416], got #{vals.inspect}")

# 2. Test Bridge hotreload / edit.reload command
bridge = ChayaRGSS::Bridge
bridge.receive_from_webview({ 'type' => 'hotreload' })
bridge.pump
check(ChayaRGSS::NativeWebview.out.any? { |s| s.include?('edit.reload.ack') }, "hotreload command should reply ack")

def pointer_state(bridge, active)
  bridge.receive_from_webview({ 'type' => 'host.pointer', 'active' => active })
  bridge.pump
end

pointer_state(bridge, true)
check([Input.mouse_x, Input.mouse_y] == [-1, -1], 'overlay hover must hide game mouse coordinates')
check(!Input.press?(Input::MOUSELEFT) && !Input.trigger?(:MOUSELEFT) && !Input.repeat?(:MOUSELEFT), 'overlay hover must mask mouse buttons')
check(Input.press?(:C) && Input.dir4 == 4, 'hovering a mini panel must not block game keyboard input')
cursor = ' ' * 8
ChayaRGSS.user32('GetCursorPos').call(cursor)
check(cursor.unpack('ll') == [-1, -1], 'Win32 mouse adapters must not bypass hover isolation')
check(ChayaRGSS.user32('GetAsyncKeyState').call(1) == 0, 'Win32 buttons must not bypass hover isolation')
pointer_state(bridge, false)
check([Input.mouse_x, Input.mouse_y] == [120, 80] && Input.press?(Input::MOUSELEFT), 'leaving a panel must restore the game mouse')
bridge.receive_from_webview({ 'type' => 'overlay.open', 'open' => true })
bridge.pump
check(!Input.press?(:C) && !Input.trigger?(:C) && !Input.repeat?(:C) && Input.dir4 == 0 && Input.dir8 == 0, 'open workbench must isolate game keyboard')
check(Input.mouse_x == -1, 'open workbench must isolate hover')
bridge.receive_from_webview({ 'type' => 'overlay.open', 'open' => false })
bridge.pump
check(Input.press?(:C) && Input.mouse_x == 120, 'closing workbench must restore input')
# Loading the isolation twice must preserve the original methods rather than recurse.
load File.expand_path('../../plugins/rgss/input.rb', __dir__)
check(Input.mouse_x == 120 && Input.press?(:C), 'hot reload must preserve raw input aliases')

puts "RGSS hotreload and user32 tests passed"

