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

puts "RGSS hotreload and user32 tests passed"

