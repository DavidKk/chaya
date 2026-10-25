# Cached translation display adapter, independent from the MV plugin entry.
load File.join(File.dirname(__FILE__), 'translation_store.rb') unless defined?(ChayaRGSS::TranslationStore)
load File.join(File.dirname(__FILE__), 'data_translation.rb') unless defined?(ChayaRGSS::DataTranslation)

module ChayaRGSS
  module Translation
    CONTROL ||= /(?:\\|\e)(?:[A-Za-z]+(?:\[[^\]]*\])?|[.!|^><{}$\\])/
    RUNTIME_CONTROL ||= /(?:\\|\e)([NPV])\[(\d+)\]/i
    RUNTIME_CURRENCY ||= /(?:\\|\e)G/i
    EXPANDABLE_CONTROL ||= /(?:\\|\e)(?:[NPV]\[\d+\]|G)/i
    class << self
      attr_reader :store, :play_settings

      def debug_enabled?
        return true if ENV['CHAYA_RGSS_TRANSLATION_DEBUG'] == '1'
        root = @root || ENV['CHAYA_RGSS_CONTENT_ROOT']
        return false if root.nil? || root.empty?
        flag = @debug_flag_path || File.join(root.to_s, 'chaya', 'config', 'translation-debug.flag')
        File.file?(flag)
      end

      def debug(kind, before, after = nil)
        return unless debug_enabled?
        return unless defined?(ChayaRGSS::Bridge) && ChayaRGSS::Bridge.respond_to?(:log)
        message = "[Translation][#{kind}] input=#{before.inspect}"
        message += " output=#{after.inspect}" unless after.nil?
        ChayaRGSS::Bridge.log(message, 'debug')
      rescue StandardError
        nil
      end

      def start(root = ENV['CHAYA_RGSS_CONTENT_ROOT'] || Dir.pwd)
        @root = root
        @debug_flag_path = File.join(root.to_s, 'chaya', 'config', 'translation-debug.flag')
        @store = TranslationStore.new(root)
        @memo = {}
        @memo_revision = @store.revision
        DataTranslation.reset
        DataTranslation.install
        @last_poll = 0
        @play_settings = { 'mode' => 'pretranslated', 'timeoutMs' => 8000 }
        @play_sig = nil
        @preview_sig = nil
        @preview_view = 'translated'
        @play_loaded = false
        @current_message_key = nil
        @current_message_window = nil
        @runtime_index = nil
        @runtime_index_revision = nil
        @runtime_index_signature = nil
        @runtime_control_refs = nil
        @runtime_control_refs_revision = nil
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
        refresh_runtime_index
        DataTranslation.refresh
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
        debug('translate', text, result) if text != result
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
        hit = runtime_lookup(text)
        return hit if hit
        codes = text.scan(/\\[A-Za-z]+\[\d+\]/)
        return nil if codes.empty?
        key = text.gsub(/\\([A-Za-z]+)\[\d+\]/) { "\\#{$1.downcase}[#]" }
        hit = @store.get(key)
        return nil unless hit && hit.scan(/\\[A-Za-z]+\[\#\]/).length == codes.length
        hit.gsub(/\\[A-Za-z]+\[\#\]/) { codes.shift }
      end

      def runtime_lookup(text)
        return nil unless @store
        # The cache revision is not enough here: actor names and variables can
        # change without touching the translation files.
        refresh_runtime_index
        return nil unless @runtime_index
        @runtime_index[@store.normalize(text)]
      end

      # RGSS may hand rendering code text after \N, \P, \V and \G have already
      # been expanded. Build aliases from the current game state so those
      # expanded strings still hit the same in-memory translation row.
      def refresh_runtime_index
        return unless @store
        refs = runtime_control_refs
        signature = runtime_signature(refs)
        return if @runtime_index && @runtime_index_revision == @store.revision && @runtime_index_signature == signature
        index = {}
        conflicts = {}
        @store.rows.each do |source, row|
          target = row['t']
          next unless source.is_a?(String) && target.is_a?(String) && !target.empty?
          next unless source =~ EXPANDABLE_CONTROL
          expanded_source, source_complete = expand_runtime_controls(source)
          next unless source_complete && expanded_source != source
          expanded_target, target_complete = expand_runtime_controls(target, @store)
          next unless target_complete
          key = @store.normalize(expanded_source)
          next if conflicts[key]
          existing = index[key]
          if existing && existing != expanded_target
            conflicts[key] = true
            index.delete(key)
          else
            index[key] = expanded_target
          end
        end
        @runtime_index = index
        @runtime_index_revision = @store.revision
        @runtime_index_signature = signature
        @memo.clear if @memo
      end

      def runtime_control_refs
        revision = @store.revision
        if @runtime_control_refs && @runtime_control_refs_revision == revision
          return @runtime_control_refs
        end
        refs = { 'actors' => {}, 'party' => {}, 'variables' => {} }
        @store.rows.each do |source, row|
          target = row['t']
          next unless source.is_a?(String) && target.is_a?(String) && !target.empty?
          next unless source =~ EXPANDABLE_CONTROL
          collect_runtime_control_refs(source, refs)
          collect_runtime_control_refs(target, refs)
        end
        @runtime_control_refs = refs
        @runtime_control_refs_revision = revision
        refs
      end

      def collect_runtime_control_refs(text, refs)
        text.scan(RUNTIME_CONTROL).each do |match|
          code = match[0].upcase
          id = match[1].to_i
          key = code == 'N' ? 'actors' : (code == 'P' ? 'party' : 'variables')
          refs[key][id] = true
        end
      end

      def runtime_signature(refs)
        parts = [@store.revision.to_s]
        refs['actors'].keys.sort.each do |id|
          value = runtime_actor_name(id)
          parts << "n#{id}:#{value.nil? ? '-' : value}"
        end
        refs['party'].keys.sort.each do |id|
          value = runtime_party_member_name(id)
          parts << "p#{id}:#{value.nil? ? '-' : value}"
        end
        refs['variables'].keys.sort.each do |id|
          value = runtime_variable_value(id)
          parts << "v#{id}:#{value.nil? ? '-' : value}"
        end
        currency = runtime_currency_unit
        parts << "g:#{currency.nil? ? '-' : currency}"
        parts.join("\x1f")
      end

      def expand_runtime_controls(text, store = nil)
        complete = true
        result = text.gsub(RUNTIME_CONTROL) do
          match = $&
          code = $1.upcase
          id = $2.to_i
          value = if code == 'N'
            runtime_actor_name(id)
          elsif code == 'P'
            runtime_party_member_name(id)
          else
            runtime_variable_value(id)
          end
          if value.nil?
            complete = false
            match
          else
            translated_runtime_value(value, store)
          end
        end
        result = result.gsub(RUNTIME_CURRENCY) do
          match = $&
          value = runtime_currency_unit
          if value.nil?
            complete = false
            match
          else
            translated_runtime_value(value, store)
          end
        end
        [result, complete]
      end

      def translated_runtime_value(value, store)
        text = value.to_s
        hit = store && !text.empty? ? store.get(text) : nil
        hit.nil? || hit.empty? ? text : hit
      end

      def translate_name_controls(text)
        return text unless @store && text.is_a?(String)
        text.gsub(/\\\\|(?:\\|\e)([NP])\[(\d+)\]/i) do |match|
          code, id = $1, $2
          next match unless code
          name = code.upcase == 'N' ? runtime_actor_name(id.to_i) : runtime_party_member_name(id.to_i)
          hit = name && @store.get(name)
          debug('name_control', { 'control' => match, 'name' => name }, hit || match)
          hit && !hit.empty? ? hit : match
        end
      end

      def runtime_actor_name(id)
        return nil unless defined?($game_actors) && $game_actors
        actor = $game_actors[id]
        return nil unless actor && actor.respond_to?(:name)
        name = actor.name
        name.is_a?(String) && !name.empty? ? name : nil
      rescue StandardError
        nil
      end

      def runtime_party_member_name(id)
        return nil unless defined?($game_party) && $game_party && $game_party.respond_to?(:members)
        member = $game_party.members[id - 1]
        return nil unless member && member.respond_to?(:name)
        name = member.name
        name.is_a?(String) && !name.empty? ? name : nil
      rescue StandardError
        nil
      end

      def runtime_variable_value(id)
        return nil unless defined?($game_variables) && $game_variables
        value = $game_variables[id]
        value.nil? ? nil : value
      rescue StandardError
        nil
      end

      def runtime_currency_unit
        return nil unless defined?(Vocab) && Vocab.respond_to?(:currency_unit)
        Vocab.currency_unit
      rescue StandardError
        nil
      end

      def resolve(text)
        hit = lookup(text)
        return hit if hit
        # Keep whitespace and RM commands verbatim; never rewrite arbitrary
        # substrings, script arguments or game resource identifiers.
        lead, core, trail = text.match(/\A(\s*)(.*?)(\s*)\z/m).captures
        hit = lookup(core)
        return lead + hit + trail if hit
        # Some scripts prefix dialogue with a talker/voice line, then put the
        # sentence on its own line. Look each line up whole first so an inline
        # \N[n] stays attached to its sentence instead of being split off.
        if text.include?("\n") || text.include?("\r")
          lines = text.split(/(\r\n|[\r\n])/)
          return lines.map do |part|
            if part =~ /\A[\r\n]+\z/
              part
            else
              lookup(part) || translate(part)
            end
          end.join if lines.any? { |part| !(part =~ /\A[\r\n]+\z/) && lookup(part) }
        end
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
          @display_font ||= [
            'Hiragino Sans GB',
            'HiraginoSansGB',
            'Hiragino Sans GB W3',
            'ChayaHeiti',
            'Heiti SC',
            'STHeiti Medium',
            'STHeitiMedium',
            'Arial Unicode MS',
            'ArialUnicodeMS',
            'Songti SC',
            'Songti',
            'Noto Sans CJK SC',
            'Microsoft YaHei',
            'SimHei',
            'Heiti TC',
            'VL PGothic',
            'VL Gothic',
            'Noto Sans CJK JP'
          ].find { |name| Font.exist?(name) }
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
          @cjk_pattern ||= Regexp.new('[\\p{Han}\\p{Hiragana}\\p{Katakana}\\u3000-\\u303F\\uFF01-\\uFF60\\uFFE0-\\uFFE6\\u2010-\\u2027\\u2030-\\u205E\\u25A0-\\u25FF\\u00B7]')
          !!(text =~ @cjk_pattern)
        else
          !!(text =~ /(?:[\xc2-\xdf][\x80-\xbf]|[\xe2-\xef][\x80-\xbf]{2})/n)
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
                translated = ChayaRGSS::Translation.translate(text)
                chaya_translation_convert(ChayaRGSS::Translation.translate_name_controls(translated))
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
              ChayaRGSS::Translation.debug('process_all_text', ($game_message.all_text rescue '')) if $game_message && $game_message.respond_to?(:all_text)
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
        DataTranslation.install
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
        if text.is_a?(String) && text.length > 1
          translated = Translation.translate(text)
          Translation.debug('draw_text', text, translated) if translated != text
          args[index] = translated
        end
        Translation.with_font(self, args[index]) { super(*args) }
      end

      def text_size(text)
        if text.is_a?(String) && text.length > 1
          translated = Translation.translate(text)
          Translation.debug('text_size', text, translated) if translated != text
          text = translated
        end
        Translation.with_font(self, text) { super(text) }
      end
    end

    module WindowText
      def convert_escape_characters(text)
        raw = text
        translated = Translation.translate_name_controls(Translation.translate(text))
        Translation.debug('convert_escape', raw, translated) if translated != raw
        super(translated)
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
