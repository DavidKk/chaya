require 'tmpdir'
require 'fileutils'

# Exercise the stock-RGSS adapter without JSON, TracePoint or Module#prepend.
module Kernel
  alias_method :native_test_require, :require
  def require(name)
    raise LoadError, 'JSON is not bundled with stock RGSS' if name == 'json'
    native_test_require(name)
  end
end
Object.send(:remove_const, :TracePoint) if defined?(TracePoint)
class << Module
  alias_method :native_test_method_defined?, :method_defined?
  def method_defined?(name)
    name == :prepend ? false : native_test_method_defined?(name)
  end
end
module Graphics
  def self.update; :updated; end
end
class Bitmap
  def draw_text(*args); args; end
  def text_size(text); text; end
end
class Window_Base
  def convert_escape_characters(text); text.gsub('\\', "\e"); end
end

def check(value, message)
  raise message unless value
end

Dir.mktmpdir('chaya-native-translation') do |root|
  destination = File.join(root, 'chaya', 'plugins', 'rgss')
  FileUtils.mkdir_p(destination)
  ['native.rb', 'translation.rb', 'translation_store.rb', 'cache_json.rb'].each do |name|
    FileUtils.cp(File.expand_path('../../plugins/rgss/' + name, __dir__), destination)
  end
  FileUtils.mkdir_p(File.join(root, 'chaya', 'translate'))
  File.write(File.join(root, 'chaya', 'translate', 'seed.json'), '{"New Game":"新游戏"}')
  cache = File.join(root, 'chaya', 'translate', 'cache.ndjson')
  File.write(cache, "{\"s\":\"Continue\",\"t\":\"继续\"}\n")
  Dir.chdir(root) do
    load File.join(destination, 'native.rb')
    check(!defined?(JSON), 'JSON fallback must not require external gems')
    json = ChayaRGSS::CacheJSON
    check(json.parse('{"a":[true,false,null,-1.25e2,"\\u4e2d\\ud83d\\ude00" ]}') == { 'a' => [true, false, nil, -125.0, '中😀'] }, 'portable JSON parser handles Unicode and values')
    ['{"a":}', '[1,]', '"\\ud800"', 'true false'].each do |invalid|
      begin
        json.parse(invalid)
        raise 'Invalid JSON accepted'
      rescue json::ParseError
      end
    end
    translation = ChayaRGSS::Translation
    check(translation.translate('New Game') == '新游戏', 'native entry loads seed')
    check(Bitmap.new.draw_text(0, 0, 100, 20, 'Continue')[4] == '继续', 'legacy bitmap aliases translate menus')
    check(Bitmap.new.text_size('Continue') == '继续', 'legacy aliases measure translated text')
    check(Window_Base.new.convert_escape_characters('New Game') == '新游戏', 'legacy window aliases translate dialogue')
    2.times { load File.join(destination, 'native.rb') }
    check(Bitmap.new.text_size('Continue') == '继续', 'legacy entry can load repeatedly without recursion')
    File.open(cache, 'a') { |file| file.write("{\"s\":\"Continue\",\"t\":\"继续游戏\"}\n") }
    translation.store.refresh
    check(Bitmap.new.text_size('Continue') == '继续游戏', 'native saved cache refresh')
    check(Graphics.update == :updated, 'native Graphics chain')

    # VX exposes the message array instead of VX Ace's conversion helper.
    Object.send(:remove_const, :Window_Base)
    class Game_Message
      def initialize; @texts = []; @choices = []; end
      attr_reader :texts, :choices
    end
    class Window_Message
      attr_reader :rendered, :rendered_choices
      def start_message
        @rendered = $game_message.texts.join("\n")
        @rendered_choices = $game_message.choices.dup
      end
    end
    translation.install
    message = Game_Message.new
    message.texts.push('New Game')
    message.choices.push('Continue')
    $game_message = message
    window = Window_Message.new
    window.start_message
    check(window.rendered == '新游戏', 'VX message display copy')
    check(window.rendered_choices == ['继续游戏'], 'VX choice display copy')
    check(message.texts == ['New Game'] && message.choices == ['Continue'], 'VX mutable source arrays restored')
    message.texts.push('Continue')
    check(message.texts.length == 2, 'VX interpreter can still append messages')

    # An adapter error after texts were replaced must restore both source arrays.
    class << translation
      alias_method :native_test_translate, :translate
      def translate(text)
        raise 'Choice translation failed' if text == 'Broken choice'
        native_test_translate(text)
      end
    end
    message.choices.replace(['Broken choice'])
    original_texts, original_choices = message.texts, message.choices
    begin
      window.start_message
      raise 'Expected translation failure'
    rescue RuntimeError => error
      check(error.message == 'Choice translation failed', 'VX adapter failure propagated')
    end
    check(message.texts.equal?(original_texts) && message.choices.equal?(original_choices), 'VX source arrays restored after translation error')
    class << translation
      alias_method :translate, :native_test_translate
    end

  end
end
puts 'RGSS native translation assertions passed'
