require 'tmpdir'
require 'json'

module Graphics
  def self.update; :updated; end
end
class Font
  attr_accessor :name
  def initialize; @name = 'Game Latin'; end
  def self.exist?(name); name == 'Heiti TC'; end
end
class Bitmap
  def font; @font ||= Font.new; end
  attr_reader :drawn, :draw_font, :measure_font
  def draw_text(*args); @drawn = args; @draw_font = font.name; end
  def text_size(text); @measure_font = font.name; text; end
end
require_relative '../../plugins/rgss/translation'

def check(value, message)
  raise message unless value
end

Dir.mktmpdir('chaya-rgss-translation') do |root|
  require 'fileutils'
  dir = File.join(root, 'chaya', 'translate')
  FileUtils.mkdir_p(dir)
  seed = File.join(dir, 'seed.json')
  cache = File.join(dir, 'cache.ndjson')
  File.write(seed, JSON.generate({ 'New Game' => '新的游戏', 'Continue' => '', 'Manual' => '手动' }))
  origin = { 'id' => '1', 'revision' => 1, 'database' => 'shared' }
  rows = [
    { 's' => 'Continue', 't' => '继续', 'origin' => origin },
    { 's' => 'Hello, Rei!', 't' => '你好，蕾！' },
    { 's' => 'Yes', 't' => '是' },
    { 's' => 'No', 't' => '否' },
    { 's' => '\\n[#] joins.', 't' => '\\n[#]加入。' },
    { 's' => 'Manual', 't' => '错误', 'origin' => origin },
    { 's' => 'ＡＢＣ', 't' => '字母' },
    { 's' => 'Thunder5', 't' => '雷霆5' },
    { 's' => 'Thunder10', 't' => '雷霆10' }
  ]
  File.write(cache, rows.map { |r| JSON.generate(r) }.join("\n") + "\n")
  translation = ChayaRGSS::Translation
  translation.start(root)
  # Simulate an alias-based game script loaded after the compatibility preload.
  class Bitmap
    alias_method :game_draw_text, :draw_text
    def draw_text(*args); game_draw_text(*args); end
  end
  module SceneManager
    def self.run; :started; end
  end
  SceneManager.run
  check(translation.translate('New Game') == '新的游戏', 'seed cache must work with no engines enabled')
  check(translation.translate('Continue') == '继续', 'durable translations must load')
  check(translation.translate('Manual') == '手动', 'shared rows must not overwrite manual seed')
  check(translation.translate('ABC') == '字母', 'normalized hash index')
  check(translation.translate('Thunder7') == '雷霆7', 'numeric labels reuse durable examples without a materialized row')
  check(translation.translate('Thunder12 power') == 'Thunder12 power', 'numeric reuse is restricted to whole labels')
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => 'Thunder10', 't' => '闪电10' })) }
  translation.store.refresh
  check(translation.translate('Thunder7') == 'Thunder7', 'conflicting numeric examples invalidate the template and memo')
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => 'Thunder10', 't' => nil })) }
  translation.store.refresh
  check(translation.translate('Thunder7') == 'Thunder7', 'one numeric example is insufficient')
  check(translation.translate("  Hello, Rei!\r\n") == "  你好，蕾！\r\n", 'preserve outer whitespace')
  source = '\\C[2]Hello, Rei!\\C[0]'
  check(translation.translate(source) == '\\C[2]你好，蕾！\\C[0]', 'control codes must survive')
  check(translation.translate("Hello, Rei!\nYes\n") == "你好，蕾！\n是\n", 'multi-line dialogue')
  check(translation.translate('Uncached English') == 'Uncached English', 'missing source unchanged')
  check(translation.translate('\\N[8] joins.') == '\\N[8]加入。', 'numeric control template restores original actor id')
  check(translation.translate('YesNo') == 'YesNo', 'no arbitrary substring translation')
  bitmap = Bitmap.new
  bitmap.draw_text(0, 0, 100, 20, 'Continue', 1)
  check(bitmap.drawn[4] == '继续' && bitmap.drawn[5] == 1, 'menu bitmap draw overload')
  bitmap.draw_text(Object.new, 'New Game', 2)
  check(bitmap.drawn[1] == '新的游戏' && bitmap.drawn[2] == 2, 'Rect bitmap draw overload')
  check(bitmap.text_size('Continue') == '继续', 'measure translated text')
  check(bitmap.draw_font == 'Heiti TC' && bitmap.measure_font == 'Heiti TC', 'Chinese drawing and measurement use same supported font')
  check(bitmap.font.name == 'Game Latin', 'font selection must not mutate the game font')
  bitmap.draw_text(0, 0, 100, 20, '中')
  check(bitmap.draw_font == 'Heiti TC', 'character-by-character drawing supports Chinese glyphs')
  bitmap.draw_text(0, 0, 100, 20, 123)
  check(bitmap.drawn[4] == 123, 'numeric draw arguments preserved')

  # Game script classes do not exist at preload time.
  class Window_Base
    def convert_escape_characters(text); text.gsub('\\', "\e"); end
  end
  class Game_Message
    attr_accessor :texts, :choices
    def all_text; @texts.join("\n"); end
  end
  Graphics.update
  window = Window_Base.new
  check(window.convert_escape_characters(source) == "\eC[2]你好，蕾！\eC[0]", 'translate before escape expansion')
  message = Game_Message.new
  message.texts = ['Hello, Rei!', 'Yes']
  message.choices = ['Yes', 'No']
  check(window.convert_escape_characters(message.all_text) == "你好，蕾！\n是", 'dialogue translated before glyph drawing')
  check(message.choices.map { |c| window.convert_escape_characters(c) } == ['是', '否'], 'choice rendering')
  check(message.texts == ['Hello, Rei!', 'Yes'] && message.choices == ['Yes', 'No'], 'original game/save data untouched')

  # Appended UTF-8 may end mid-row or mid-character; publish only completed rows.
  event = JSON.generate({ 's' => 'Continue', 't' => '继续游戏', 'origin' => origin }) + "\n"
  bytes = event.b
  File.open(cache, 'ab') { |f| f.write(bytes[0, 30]) }
  translation.store.refresh
  check(translation.translate('Continue') == '继续', 'partial append must not replace valid cache')
  File.open(cache, 'ab') { |f| f.write(bytes[30..-1]) }
  translation.store.refresh
  check(translation.translate('Continue') == '继续游戏', 'append invalidates memo without restart')
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => 'Continue', 't' => nil, 'origin' => origin.merge('id' => 'other') })) }
  translation.store.refresh
  check(translation.translate('Continue') == '继续游戏', 'unrelated shared invalidation ignored')
  File.open(cache, 'a') { |f| f.puts(JSON.generate({ 's' => 'Continue', 't' => nil, 'origin' => origin })) }
  translation.store.refresh
  check(translation.translate('Continue') == 'Continue', 'matching tombstone removes translation and memo')
  File.write(cache, JSON.generate(['Continue', '继续冒险']) + "\n")
  translation.store.refresh
  check(translation.translate('Continue') == '继续冒险', 'cache truncation rebuild and legacy array')
  File.write(seed, JSON.generate({ 'New Game' => '新游戏' }))
  translation.store.refresh
  check(translation.translate('New Game') == '新游戏', 'seed modification reload')
  2.times { load File.expand_path('../../plugins/rgss/translation.rb', __dir__) }
  check(Bitmap.ancestors.count { |ancestor| ancestor == translation::BitmapText } == 1, 'hotreload must not wrap twice')
  check(Graphics.update == :updated, 'Graphics update chain preserved')
end
puts 'RGSS translation assertions passed'
