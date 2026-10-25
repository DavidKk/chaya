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
  ['native.rb', 'translation.rb', 'translation_store.rb', 'data_translation.rb', 'cache_json.rb'].each do |name|
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
      attr_accessor :text
      def initialize
        @text = ""
      end
      def start_message
        @rendered = $game_message.texts.join("\n")
        @rendered_choices = $game_message.choices.dup
        @text = @rendered.dup
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

    # Play settings, subtitle mode, realtime mode, and limits
    config_dir = File.join(root, 'chaya', 'config')
    FileUtils.mkdir_p(config_dir)
    play_file = File.join(config_dir, 'translation-play.json')
    File.write(play_file, '{"mode":"subtitle","timeoutMs":5000}')
    translation.load_play_settings
    # Without NativeWebview, play_mode must fallback to pretranslated
    check(translation.play_mode == 'pretranslated', 'fallback to pretranslated when webview is not ready')

    module NativeWebview
      def self.ready?; true; end
    end
    check(translation.play_mode == 'subtitle', 'subtitle mode active when webview ready')
    check(translation.play_timeout_ms == 5000, 'custom timeout read')
    check(translation.translate('New Game') == 'New Game', 'subtitle mode leaves on-screen text unchanged')

    # Mock Bridge for dialogue dispatching
    module ChayaRGSS
      module Bridge
        class << self
          attr_accessor :dispatched
          def dispatch_reply(msg)
            (@dispatched ||= []) << msg
          end
        end
      end
    end
    ChayaRGSS::Bridge.dispatched = []

    class Window_Message
      def terminate_message
        $game_message.texts.clear
        $game_message.choices.clear
      end
    end
    translation.install

    message.texts.replace(['Hello'])
    message.choices.replace(['Yes', 'No'])
    window.start_message
    check(window.rendered == 'Hello', 'subtitle mode renders raw Japanese')
    last_msg = ChayaRGSS::Bridge.dispatched.last
    check(last_msg && last_msg['type'] == 'translation.dialogue', 'subtitle dispatches dialogue event')
    check(last_msg['mode'] == 'subtitle', 'dispatched mode is subtitle')
    check(last_msg['texts'] == ['Hello'], 'dispatched texts match')
    check(last_msg['timeoutMs'] == 5000, 'dispatched timeout matches')
    current_key = last_msg['key']

    window.terminate_message
    last_msg = ChayaRGSS::Bridge.dispatched.last
    check(last_msg && last_msg['type'] == 'translation.dialogue.close', 'close dispatched on terminate_message')

    # Realtime mode
    File.write(play_file, '{"mode":"realtime","timeoutMs":8000}')
    translation.load_play_settings
    check(translation.play_mode == 'realtime', 'realtime mode active')

    ChayaRGSS::Bridge.dispatched.clear
    message.texts.replace(['Uncached dialogue'])
    message.choices.clear
    window.start_message
    last_msg = ChayaRGSS::Bridge.dispatched.last
    check(last_msg && last_msg['type'] == 'translation.dialogue', 'realtime dispatches dialogue for uncached text')
    dialogue_key = last_msg['key']

    # Stale/obsolete result is discarded
    translation.handle_dialogue_result({ 'type' => 'translation.dialogue.result', 'key' => 'mismatched_key', 'texts' => ['错配译文'] })
    check(window.instance_variable_get(:@text).nil? || !(window.instance_variable_get(:@text) =~ /错配译文/), 'stale key discarded')

    # Matching result updates display
    translation.handle_dialogue_result({ 'type' => 'translation.dialogue.result', 'key' => dialogue_key, 'texts' => ['已翻译对白'] })
    check(window.instance_variable_get(:@text) =~ /已翻译对白/, 'matching key updates display')

    # Overlong or too many choices skip dispatch
    ChayaRGSS::Bridge.dispatched.clear
    message.texts.replace(['A' * 361])
    window.start_message
    check(ChayaRGSS::Bridge.dispatched.empty?, 'overlong dialogue skipped')

    message.texts.replace(['A'])
    message.choices.replace((1..8).map(&:to_s))
    window.start_message
    check(ChayaRGSS::Bridge.dispatched.empty?, 'excess choices skipped')

  end
end
puts 'RGSS native translation assertions passed'
