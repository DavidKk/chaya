# Cached translation display adapter, independent from the MV plugin entry.
load File.join(File.dirname(__FILE__), 'translation_store.rb') unless defined?(ChayaRGSS::TranslationStore)

module ChayaRGSS
  module Translation
    CONTROL ||= /(?:\\|\e)(?:[A-Za-z]+(?:\[[^\]]*\])?|[.!|^><{}$\\])/
    class << self
      attr_reader :store

      def start(root = ENV['CHAYA_RGSS_CONTENT_ROOT'] || Dir.pwd)
        @store = TranslationStore.new(root)
        @memo = {}
        @memo_revision = @store.revision
        @last_poll = 0
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
                chaya_translation_start_message(*args)
              ensure
                originals.each { |key, value| message.instance_variable_set(key, value) }
              end
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
