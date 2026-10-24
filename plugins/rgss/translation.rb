# Cached translation display adapter, independent from the MV plugin entry.
load File.join(File.dirname(__FILE__), 'translation_store.rb') unless defined?(ChayaRGSS::TranslationStore)

module ChayaRGSS
  module Translation
    CONTROL ||= /(?:\\|\e)(?:[A-Za-z]+(?:\[[^\]]*\])?|[.!|^><{}$\\])/
    class << self
      attr_reader :store, :play_settings

      def start(root = ENV['CHAYA_RGSS_CONTENT_ROOT'] || Dir.pwd)
        @root = root
        @store = TranslationStore.new(root)
        @memo = {}
        @memo_revision = @store.revision
        @last_poll = 0
        @play_settings = { 'mode' => 'pretranslated', 'timeoutMs' => 8000 }
        @play_sig = nil
        @preview_sig = nil
        @preview_view = 'translated'
        @play_loaded = false
        @current_message_key = nil
        @current_message_window = nil
        load_play_settings
        arm_startup
        @store.refresh
        @memo_revision = @store.revision
      rescue StandardError => error
        report(error)
      end

      def report(error)
        message = "Translation cache unavailable: #{error.class}: #{error.message}"
        if defined?(ChayaRGSS::Bridge)
          ChayaRGSS::Bridge.log(message, 'warn')
        elsif defined?(System)
          System.puts("[Chaya RGSS] #{message}")
        end
      end

      # Install after packed scripts have defined their alias-based wrappers.
      # Prepending Bitmap during preload would make later draw_text aliases recurse.
      def arm_startup
        unless defined?(TracePoint)
          install
          return
        end
        @startup_trace.disable if @startup_trace
        @startup_trace = TracePoint.new(:call) do |event|
          scene_manager = event.method_id == :run && defined?(SceneManager) && event.self.equal?(SceneManager)
          scene_main = event.method_id == :main && (event.self.class.name.to_s =~ /\AScene_/)
          if scene_manager || scene_main
            @startup_trace.disable
            install
          end
        end
        @startup_trace.enable
      end

      def tick
        @startup_trace.disable if @startup_trace && @startup_trace.enabled?
        install
        return unless @store
        now = Process.respond_to?(:clock_gettime) ? Process.clock_gettime(Process::CLOCK_MONOTONIC) : Time.now.to_f
        return if now - @last_poll < 1.0
        @last_poll = now
        load_play_settings
        return if @reader && @reader.alive?
        @reader = Thread.new do
          begin
            @store.refresh
          rescue StandardError => error
            report(error)
          end
        end
      end

      def translate(text)
        return text if play_mode == 'subtitle' || preview_original?
        return text unless @store && text.is_a?(String) && !text.empty? && (!text.respond_to?(:valid_encoding?) || text.valid_encoding?)
        if @memo_revision != @store.revision
          @memo.clear
          @memo_revision = @store.revision
        end
        return @memo[text] if @memo.key?(text)
        result = resolve(text)
        @memo.clear if @memo.size >= 4096
        @memo[text.dup.freeze] = result
        result
      end

      def preview_original?
        @preview_view == 'original'
      end

      def load_play_settings
        public_root = ENV['CHAYA_PUBLIC_GAME_DIR']
        base = (public_root && !public_root.empty?) ? public_root : (@root || Dir.pwd)
        path = File.join(base, 'config', 'translation-play.json')
        path = File.join(base, 'chaya', 'config', 'translation-play.json') unless File.file?(path)
        preview = File.join(base, 'config', 'translation-preview.json')
        preview = File.join(base, 'chaya', 'config', 'translation-preview.json') unless File.file?(preview)
        sig = nil
        preview_sig = nil
        if File.file?(path)
          stat = File.stat(path) rescue nil
          sig = [path, stat.ino, stat.size, stat.mtime.to_f] if stat
        end
        if File.file?(preview)
          pstat = File.stat(preview) rescue nil
          preview_sig = [preview, pstat.ino, pstat.size, pstat.mtime.to_f] if pstat
        end
        return if @play_loaded && sig == @play_sig && preview_sig == @preview_sig
        @play_loaded = true
        @play_sig = sig
        @preview_sig = preview_sig
        previous_preview = @preview_view
        @preview_view = 'translated'
        if preview_sig
          begin
            content = File.open(preview, 'rb') { |f| f.read }
            content = content.respond_to?(:force_encoding) ? content.force_encoding('UTF-8') : content
            parsed = ChayaRGSS::CacheJSON.parse(content)
            @preview_view = 'original' if parsed.is_a?(Hash) && parsed['view'].to_s == 'original'
          rescue StandardError
            @preview_view = 'translated'
          end
        end
        @memo.clear if @memo && previous_preview != @preview_view
        unless sig
          @play_settings = { 'mode' => 'pretranslated', 'timeoutMs' => 8000 }
          return
        end
        begin
          content = File.open(path, 'rb') { |f| f.read }
          content = content.respond_to?(:force_encoding) ? content.force_encoding('UTF-8') : content
          parsed = ChayaRGSS::CacheJSON.parse(content)
          if parsed.is_a?(Hash)
            mode = parsed['mode'].to_s
            mode = 'pretranslated' unless mode == 'realtime' || mode == 'subtitle'
            timeout = parsed['timeoutMs']
            timeout = (timeout.is_a?(Numeric) && timeout >= 2000 && timeout <= 30000) ? timeout.to_i : 8000
            @play_settings = { 'mode' => mode, 'timeoutMs' => timeout }
          else
            @play_settings = { 'mode' => 'pretranslated', 'timeoutMs' => 8000 }
          end
        rescue StandardError
          @play_settings = { 'mode' => 'pretranslated', 'timeoutMs' => 8000 }
        end
      end

      def native_webview_ready?
        if defined?(ChayaRGSS::NativeWebview) && ChayaRGSS::NativeWebview.respond_to?(:ready?)
          ChayaRGSS::NativeWebview.ready?
        elsif defined?(NativeWebview) && NativeWebview.respond_to?(:ready?)
          NativeWebview.ready?
        else
          false
        end
      end

      def play_mode
        mode = (@play_settings && @play_settings['mode']) || 'pretranslated'
        return 'pretranslated' if (mode == 'realtime' || mode == 'subtitle') && !native_webview_ready?
        mode
      end

      def play_timeout_ms
        (@play_settings && @play_settings['timeoutMs']) || 8000
      end

      def on_message_start(texts, choices, window = nil)
        mode = play_mode
        return unless mode == 'realtime' || mode == 'subtitle'
        return unless native_webview_ready?
        text_list = (texts.is_a?(Array) ? texts : [texts]).compact.map(&:to_s)
        choice_list = (choices.is_a?(Array) ? choices : [choices]).compact.map(&:to_s)
        return if text_list.empty? && choice_list.empty?

        total_len = text_list.inject(0) { |sum, t| sum + t.length } + choice_list.inject(0) { |sum, c| sum + c.length }
        return if total_len > 360 || choice_list.length > 7

        if mode == 'realtime'
          unhit = text_list.any? { |t| !lookup(t) } || choice_list.any? { |c| !lookup(c) }
          return unless unhit
        end

        key = "#{text_list.join("\n")}\x1f#{choice_list.join("\x1f")}"
        @current_message_key = key
        @current_message_window = window

        if defined?(ChayaRGSS::Bridge) && ChayaRGSS::Bridge.respond_to?(:dispatch_reply)
          ChayaRGSS::Bridge.dispatch_reply(
            'type' => 'translation.dialogue',
            'key' => key,
            'texts' => text_list,
            'choices' => choice_list,
            'mode' => mode,
            'timeoutMs' => play_timeout_ms
          )
        end
      end

      def on_message_close(window = nil)
        had_message = !@current_message_key.nil?
        @current_message_key = nil
        @current_message_window = nil
        if had_message && defined?(ChayaRGSS::Bridge) && ChayaRGSS::Bridge.respond_to?(:dispatch_reply)
          ChayaRGSS::Bridge.dispatch_reply('type' => 'translation.dialogue.close')
        end
      end

      def handle_dialogue_result(msg)
        key = msg['key']
        texts = msg['texts']
        choices = msg['choices']
        @store.refresh if @store
        return unless key && key == @current_message_key
        window = @current_message_window
        return unless window && (!window.respond_to?(:disposed?) || !window.disposed?) && (!window.respond_to?(:visible) || window.visible)
        return unless play_mode == 'realtime'
        update_message_window_display(window, texts, choices)
      end

      def update_message_window_display(window, texts, choices = nil)
        lines = texts.is_a?(Array) ? texts : [texts.to_s]
        if window.respond_to?(:draw_text_ex)
          window.contents.clear if window.respond_to?(:contents) && window.contents && (!window.contents.respond_to?(:disposed?) || !window.contents.disposed?)
          x = window.respond_to?(:new_line_x) ? (window.new_line_x rescue 0) : 0
          window.draw_text_ex(x, 0, lines.join("\n")) rescue nil
        else
          if window.respond_to?(:contents) && window.contents && (!window.contents.respond_to?(:disposed?) || !window.contents.disposed?)
            window.contents.clear
            line_height = window.respond_to?(:line_height) ? window.line_height : 24
            y = 0
            lines.each do |line|
              window.contents.draw_text(0, y, window.contents.width, line_height, line)
              y += line_height
            end
          end
          if window.instance_variable_defined?(:@text)
            window.instance_variable_set(:@text, lines.join("\n") + "\n")
          end
        end
      end

      def lookup(text)
        hit = @store.get(text)
        return hit if hit
        codes = text.scan(/\\[A-Za-z]+\[\d+\]/)
        return nil if codes.empty?
        key = text.gsub(/\\([A-Za-z]+)\[\d+\]/) { "\\#{$1.downcase}[#]" }
        hit = @store.get(key)
        return nil unless hit && hit.scan(/\\[A-Za-z]+\[\#\]/).length == codes.length
        hit.gsub(/\\[A-Za-z]+\[\#\]/) { codes.shift }
      end

      def resolve(text)
        hit = lookup(text)
        return hit if hit
        # Keep whitespace and RM commands verbatim; never rewrite arbitrary
        # substrings, script arguments or game resource identifiers.
        lead, core, trail = text.match(/\A(\s*)(.*?)(\s*)\z/m).captures
        hit = lookup(core)
        return lead + hit + trail if hit
        if (text =~ CONTROL) || text.include?("\n") || text.include?("\r")
          return text.split(/(#{CONTROL}|\r\n|[\r\n])/).map do |part|
            (part =~ /\A#{CONTROL}\z/) || (part =~ /\A[\r\n]+\z/) ? part : translate(part)
          end.join
        end
        text
      end

      # RGSS does not discover macOS system fonts automatically. The launcher
      # mounts a Chinese font as an isolated RTP resource before Ruby starts.
      def with_font(bitmap, text)
        previous = nil
        if defined?(Font) && bitmap.respond_to?(:font) && text.is_a?(String) && cjk?(text)
          @display_font ||= ['Noto Sans CJK SC', 'Noto Sans CJK JP', 'Arial Unicode MS', 'Heiti TC', 'Microsoft YaHei', 'SimHei'].find { |name| Font.exist?(name) }
          if @display_font
            previous = bitmap.font.name
            bitmap.font.name = @display_font
          end
        end
        yield
      ensure
        bitmap.font.name = previous if previous
      end

      def cjk?(text)
        if text.respond_to?(:encoding)
          @cjk_pattern ||= Regexp.new('[\\p{Han}\\p{Hiragana}\\p{Katakana}]')
          !!(text =~ @cjk_pattern)
        else
          !!(text =~ /[\xe3-\xe9][\x80-\xbf]{2}/n)
        end
      end

      def install_legacy
        if !Module.method_defined?(:prepend) && defined?(Bitmap) && !Bitmap.method_defined?(:chaya_translation_draw_text)
          Bitmap.class_eval do
            alias_method :chaya_translation_draw_text, :draw_text
            alias_method :chaya_translation_text_size, :text_size
            def draw_text(*args)
              index = args.length <= 3 ? 1 : 4
              text = args[index]
              args[index] = ChayaRGSS::Translation.translate(text) if text.is_a?(String) && text.length > 1
              ChayaRGSS::Translation.with_font(self, args[index]) { chaya_translation_draw_text(*args) }
            end
            def text_size(text)
              text = ChayaRGSS::Translation.translate(text) if text.is_a?(String) && text.length > 1
              ChayaRGSS::Translation.with_font(self, text) { chaya_translation_text_size(text) }
            end
          end
        end
        if defined?(Window_Base) && Window_Base.method_defined?(:convert_escape_characters)
          unless Window_Base.method_defined?(:chaya_translation_convert)
            Window_Base.class_eval do
              alias_method :chaya_translation_convert, :convert_escape_characters
              def convert_escape_characters(text)
                chaya_translation_convert(ChayaRGSS::Translation.translate(text))
              end
            end
          end
        elsif defined?(Window_Message) && Window_Message.method_defined?(:start_message) && !Window_Message.method_defined?(:chaya_translation_start_message)
          # VX builds its display text directly from the message arrays. Keep
          # their mutable getters intact: event interpreters append through them.
          Window_Message.class_eval do
            alias_method :chaya_translation_start_message, :start_message
            def start_message(*args)
              message = $game_message
              originals = {}
              begin
                [:@texts, :@choices].each do |key|
                  value = message.instance_variable_get(key) if message
                  if value.is_a?(Array)
                    originals[key] = value
                    message.instance_variable_set(key, value.map { |text| ChayaRGSS::Translation.translate(text) })
                  end
                end
                ChayaRGSS::Translation.on_message_start(originals[:@texts] || [], originals[:@choices] || [], self)
                chaya_translation_start_message(*args)
              ensure
                originals.each { |key, value| message.instance_variable_set(key, value) }
              end
            end
          end
        end
        install_message_dialogue_hooks
      end

      def install_message_dialogue_hooks
        return unless defined?(Window_Message)
        if Window_Message.method_defined?(:process_all_text) && !Window_Message.method_defined?(:chaya_translation_process_all_text)
          Window_Message.class_eval do
            alias_method :chaya_translation_process_all_text, :process_all_text
            def process_all_text(*args)
              texts = $game_message && $game_message.respond_to?(:texts) ? $game_message.texts.dup : []
              choices = $game_message && $game_message.respond_to?(:choices) ? $game_message.choices.dup : []
              ChayaRGSS::Translation.on_message_start(texts, choices, self)
              chaya_translation_process_all_text(*args)
            end
          end
        end
        if Window_Message.method_defined?(:terminate_message) && !Window_Message.method_defined?(:chaya_translation_terminate_message)
          Window_Message.class_eval do
            alias_method :chaya_translation_terminate_message, :terminate_message
            def terminate_message(*args)
              ChayaRGSS::Translation.on_message_close(self)
              chaya_translation_terminate_message(*args)
            end
          end
        end
        if Window_Message.method_defined?(:close_and_wait) && !Window_Message.method_defined?(:chaya_translation_close_and_wait)
          Window_Message.class_eval do
            alias_method :chaya_translation_close_and_wait, :close_and_wait
            def close_and_wait(*args)
              ChayaRGSS::Translation.on_message_close(self)
              chaya_translation_close_and_wait(*args)
            end
          end
        end
        if Window_Message.method_defined?(:close) && !Window_Message.method_defined?(:chaya_translation_close)
          Window_Message.class_eval do
            alias_method :chaya_translation_close, :close
            def close(*args)
              ChayaRGSS::Translation.on_message_close(self)
              chaya_translation_close(*args)
            end
          end
        end
      end

      def install
        @installed = true
        unless Module.method_defined?(:prepend)
          install_legacy
          return
        end
        if defined?(Bitmap) && !Bitmap.ancestors.include?(BitmapText)
          Bitmap.prepend(BitmapText)
        end
        if defined?(Window_Base) && Window_Base.method_defined?(:convert_escape_characters) && !Window_Base.ancestors.include?(WindowText)
          Window_Base.prepend(WindowText)
        end
        install_legacy if defined?(Window_Message) && (!defined?(Window_Base) || !Window_Base.method_defined?(:convert_escape_characters))
        install_message_dialogue_hooks
      end
    end

    module BitmapText
      def draw_text(*args)
        index = args.length <= 3 ? 1 : 4
        text = args[index]
        # Character-by-character message drawing must keep its original glyph.
        args[index] = Translation.translate(text) if text.is_a?(String) && text.length > 1
        Translation.with_font(self, args[index]) { super(*args) }
      end

      def text_size(text)
        text = Translation.translate(text) if text.is_a?(String) && text.length > 1
        Translation.with_font(self, text) { super(text) }
      end
    end

    module WindowText
      def convert_escape_characters(text)
        super(Translation.translate(text))
      end
    end
  end
end

class << Graphics
  unless method_defined?(:chaya_translation_update)
    alias_method :chaya_translation_update, :update
    def update(*args)
      ChayaRGSS::Translation.tick
      chaya_translation_update(*args)
    end
  end
end

ChayaRGSS::Translation.start unless ChayaRGSS::Translation.store
ChayaRGSS::Translation.install if ChayaRGSS::Translation.instance_variable_get(:@installed)
