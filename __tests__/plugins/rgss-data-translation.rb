require 'tmpdir'
require 'fileutils'
require 'json'

module Graphics
  def self.update; end
end

def load_data(filename)
  Marshal.load(File.binread(filename))
end

Command = Struct.new(:code, :parameters)
Page = Struct.new(:list)
Event = Struct.new(:pages)
MapData = Struct.new(:events)
CommonEvent = Struct.new(:list)

require_relative '../../plugins/rgss/translation'

def check(value, message)
  raise message unless value
end

Dir.mktmpdir('chaya-data-translation') do |root|
  FileUtils.mkdir_p(File.join(root, 'chaya', 'translate'))
  data_dir = File.join(root, 'Data')
  FileUtils.mkdir_p(data_dir)
  source = "Oh, I see. You've been working hard, \\N[5]."
  target = '你好，你一直很努力，\\N[5]。'
  cache = File.join(root, 'chaya', 'translate', 'cache.ndjson')
  File.write(cache, [
    { 's' => source, 't' => target },
    { 's' => 'Yes', 't' => '是' },
    { 's' => 'No', 't' => '否' }
  ].map { |row| JSON.generate(row) }.join("\n") + "\n")
  translation = ChayaRGSS::Translation
  translation.start(root)
  adapter = ChayaRGSS::DataTranslation
  commands = [
    Command.new(101, ['FaceName', 0, 0, 2]),
    Command.new(401, [source]),
    Command.new(102, [['Yes', 'No'], 0]),
    Command.new(355, [source]),
    Command.new(108, [source]),
    Command.new(405, ['Yes']),
    Command.new(401, ['Not cached'])
  ]
  map = MapData.new({ 1 => Event.new([Page.new(commands)]) })
  path = File.join(data_dir, 'Map001.rvdata2')
  bytes = Marshal.dump(map)
  File.binwrite(path, bytes)
  loaded = load_data(path)
  list = loaded.events[1].pages[0].list
  check(list[1].parameters[0] == target, 'dialogue must be translated before the caller receives decoded data')
  check(list[2].parameters[0] == ['是', '否'], 'choice display strings translated in memory')
  check(list[0].parameters[0] == 'FaceName', 'portrait identifiers unchanged')
  check(list[3].parameters[0] == source && list[4].parameters[0] == source, 'scripts and comments unchanged')
  check(list[5].parameters[0] == '是', 'scrolling dialogue translated')
  check(File.binread(path) == bytes, 'original game file unchanged')
  check(load_data(path).events[1].pages[0].list[1].parameters[0] == target, 'subsequent loads do not double translate')
  # Refresh operates on the latest map only.
  loaded = load_data(path)
  list = loaded.events[1].pages[0].list
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => 'Not cached', 't' => '后来完成' })) }
  translation.store.refresh
  adapter.refresh
  check(list[6].parameters[0] == '后来完成', 'new cache translations update already loaded fields')
  list[6].parameters[0] = 'Edited by game'
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => 'Not cached', 't' => '更新译文' })) }
  translation.store.refresh
  adapter.refresh
  check(list[6].parameters[0] == 'Edited by game', 'later game edits take ownership of their fields')
  translation.instance_variable_set(:@preview_view, 'original')
  adapter.refresh
  check(list[1].parameters[0] == source, 'original preview restores original event text')
  translation.instance_variable_set(:@preview_view, 'translated')
  adapter.refresh
  check(list[1].parameters[0] == target, 'translated preview reapplies from original source')
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => source, 't' => nil })) }
  translation.store.refresh
  adapter.refresh
  check(list[1].parameters[0] == source, 'cache deletion restores source')
  common_path = File.join(data_dir, 'CommonEvents.rvdata')
  File.binwrite(common_path, Marshal.dump([nil, CommonEvent.new([Command.new(401, ['Yes'])])]))
  check(load_data(common_path)[1].list[0].parameters[0] == '是', 'VX common event dialogue')
  troop_path = File.join(data_dir, 'Troops.rxdata')
  File.binwrite(troop_path, Marshal.dump([nil, Event.new([Page.new([Command.new(101, ['Yes'])])])]))
  check(load_data(troop_path)[1].pages[0].list[0].parameters[0] == '是', 'XP battle dialogue first line')
  save_path = File.join(root, 'Save01.rvdata2')
  File.binwrite(save_path, bytes)
  check(load_data(save_path).events[1].pages[0].list[1].parameters[0] == source, 'save loads excluded')
  check(Object.private_method_defined?(:load_data), 'load_data visibility preserved')
  load File.expand_path('../../plugins/rgss/data_translation.rb', __dir__)
  adapter.install
  check(load_data(common_path)[1].list[0].parameters[0] == '是', 'hot reload does not recurse')
end
puts 'RGSS data translation assertions passed'
