require 'tmpdir'
require 'ostruct'
require 'json'
module Graphics
  def self.frame_count; 123; end
  def self.update; end
end
module ChayaRGSS
  module NativeWebview
    def self.start; end
    def self.pump; end
    def self.ready?; true; end
    def self.eval_js(source); (@out ||= []) << source; end
    def self.out; @out || []; end
  end
end
# Load the production bridge with a fake native C ABI boundary, not a fake bridge.
$LOADED_FEATURES << File.expand_path('../../plugins/rgss/native_webview.rb', __dir__)
require_relative '../../plugins/rgss/bridge'
def check(value, message)
  raise message unless value
end
Dir.mktmpdir('chaya-rgss-test') do |directory|
  ENV['CHAYA_RGSS_SESSION'] = directory
  ENV['CHAYA_RGSS_ROOM'] = 'test-room'
  $data_system = OpenStruct.new(:version_id => 7, :variables => ['', 'Score'], :switches => ['', 'Door'])
  $game_party = OpenStruct.new(:members => [OpenStruct.new(:name => 'Hero')], :gold => 10)
  def $game_party.gain_gold(delta); self.gold += delta; end
  raw_map = OpenStruct.new(:width => 20, :height => 15, :encounter_step => 30, :display_name => 'Town')
  ev_graphic = OpenStruct.new(:character_name => 'Actor1', :tile_id => 0)
  ev_page = OpenStruct.new(:trigger => 0, :list => [1, 2], :graphic => ev_graphic)
  raw_event = OpenStruct.new(:id => 1, :name => 'NPC', :pages => [ev_page])
  live_event = OpenStruct.new(:x => 2, :y => 3)
  live_event.instance_variable_set(:@event, raw_event)
  live_event.instance_variable_set(:@page, ev_page)
  $game_map = OpenStruct.new(:map_id => 1, :events => { 1 => live_event })
  $game_map.instance_variable_set(:@map, raw_map)
  $game_player = OpenStruct.new(:x => 4, :y => 8, :direction => 2)
  $game_variables = [nil, 5]
  $game_switches = [nil, false]
  bridge = ChayaRGSS::Bridge
  bridge.receive_from_webview(JSON.generate({ 'type' => 'edit.cmd', 'op' => 'gold', 'value' => 50, 'cmdId' => 'gold1' }))
  bridge.receive_from_webview({ 'type' => 'edit.cmd', 'op' => 'var', 'id' => 1, 'value' => 42, 'cmdId' => 'var1' })
  bridge.receive_from_webview({ 'type' => 'edit.cmd', 'op' => 'missing', 'cmdId' => 'bad1' })
  bridge.receive_from_webview({ 'type' => 'edit.map.request', 'mapId' => 1 })
  bridge.receive_from_webview({ 'type' => 'edit.catalog.request' })
  bridge.pump
  check($game_party.gold == 50 && $game_variables[1] == 42, 'game edits did not reach real state')
  check(ChayaRGSS::NativeWebview.out.any? { |text| text.include?('edit.map') && text.include?('Town') }, 'edit.map detail response missing')
  check(ChayaRGSS::NativeWebview.out.any? { |text| text.include?('edit.catalog') && text.include?('Score') }, 'edit.catalog response missing')
  check(ChayaRGSS::NativeWebview.out.any? { |text| text.include?('bad1') && text.include?('false') }, 'unsupported commands must return failure')
  saves = ChayaRGSS::Saves
  settings = saves.settings.merge('quickEnabled' => true, 'revision' => 1)
  check(saves.handle({ 'op' => 'configure', 'settings' => settings, 'expectedRevision' => 0 })['ok'], 'configure failed')
  saved = saves.handle({ 'op' => 'save', 'target' => 'quick', 'slot' => 0, 'reqId' => 'save1' })
  check(saved['ok'] && saved['snapshot']['index']['entries'].size == 1, 'save failed')
  $game_variables[1] = 99
  loaded = saves.handle({ 'op' => 'load', 'entryId' => 'quick-0' })
  check(loaded['ok'] && $game_variables[1] == 42, 'load did not restore variables')
  check(!saves.handle({ 'op' => 'delete', 'entryId' => '../../outside' })['ok'], 'accepted a path traversal')
  check(!saves.handle({ 'op' => 'configure', 'settings' => settings, 'expectedRevision' => 0 })['ok'], 'accepted stale revision')
  deleted = saves.handle({ 'op' => 'delete', 'entryId' => 'quick-0' })
  check(deleted['ok'] && deleted['snapshot']['index']['entries'].empty?, 'delete failed')
  check(!File.exist?(File.join(directory, 'saves', 'quick-0.marshal')), 'delete left content behind')
end
puts 'RGSS runtime assertions passed'
