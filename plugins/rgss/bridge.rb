# Native RGSS Bridge for Chaya (In-Game Native WebView Bridge)
require 'json'
require 'thread'
require_relative 'native_webview'
require_relative 'saves'
require_relative 'map'
require_relative 'edit_runtime'

module ChayaRGSS
  module Bridge
    LIMIT ||= 64
    class << self
      def log(message, level = 'info')
        return unless @logs && @logs.size < LIMIT
        @log_seq = (@log_seq || 0) + 1
        @logs << { 'id' => @log_seq, 'ts' => (Time.now.to_f * 1000).to_i, 'source' => 'ChayaRGSS', 'level' => level, 'message' => message.to_s[0, 8000] }
      end

      def integer(value, min, max)
        raise 'Expected bounded integer' unless value.is_a?(Integer) && value >= min && value <= max
        value
      end

      def names(kind)
        raise 'Game database is not ready' unless $data_system
        kind == 'var' ? $data_system.variables : $data_system.switches
      end

      def read_actors_session
        EditActors.snapshot
      end
      def full_session_state
        ready = !!($data_system && $game_party && $game_variables && $game_switches)
        return { 'ready' => false } unless ready

        vars = {}
        (1...names('var').size).each do |id|
          val = $game_variables[id]
          vars[id] = val if val.is_a?(Numeric) && (!val.respond_to?(:finite?) || val.finite?)
        end

        switches = {}
        (1...names('sw').size).each do |id|
          val = $game_switches[id]
          switches[id] = !!val
        end

        session = {
          'gold' => $game_party.gold,
          'counts' => EditRuntime.counts,
          'vars' => vars,
          'switches' => switches,
          'locks' => EditRuntime.lock_values,
          'actors' => read_actors_session,
          'walkRate' => 1,
          'runRate' => 1,
          'gameSpeed' => 1,
          'fullscreen' => false,
          'alwaysDash' => false,
          'god' => false,
          'autoWin' => false,
          'autoBattle' => false,
          'through' => false,
          'autotalk' => false,
          'encounter' => true,
          'menuEnabled' => true,
          'saveEnabled' => true,
          'clickMove' => true,
          'followers' => true,
          'clickTeleport' => false,
          'resourceSkip' => false,
          'expRate' => 1
        }.merge(EditRuntime.run_flags)

        on_map = !!($game_map && $game_player)
        { 'type' => 'edit.state', 'ready' => true, 'session' => session, 'onMap' => on_map,
          'mapId' => on_map ? $game_map.map_id : 0, 'playerX' => on_map ? $game_player.x : 0,
          'playerY' => on_map ? $game_player.y : 0, 'playerDir' => on_map && $game_player.respond_to?(:direction) ? $game_player.direction : 2 }
      end

      def t_name(text)
        return '' if text.nil?
        str = text.to_s
        return '' if str.empty?
        if defined?(ChayaRGSS::Translation) && ChayaRGSS::Translation.respond_to?(:translate)
          zh = ChayaRGSS::Translation.translate(str)
          return zh if zh && !zh.empty?
        end
        str
      end

      def catalog_entry(entry, with_desc = false)
        raw_name = entry.name.to_s
        name = t_name(raw_name)
        res = { 'id' => entry.id, 'name' => name }
        if with_desc && entry.respond_to?(:description)
          raw_desc = entry.description.to_s
          desc = t_name(raw_desc)
          desc = raw_name if (desc.nil? || desc.empty?) && name != raw_name
          res['description'] = desc if desc && !desc.empty?
        elsif name != raw_name
          res['description'] = raw_name
        end
        res
      end

      def catalog
        data = { 'ok' => true, 'contentRoot' => (ENV['CHAYA_RGSS_CONTENT_ROOT'] || ''), 'source' => 'disk' }
        {
          'items' => [$data_items, true],
          'weapons' => [$data_weapons, true],
          'armors' => [$data_armors, true],
          'actors' => [$data_actors, false],
          'skills' => [$data_skills, true],
          'states' => [$data_states, true],
          'classes' => [$data_classes, false]
        }.each do |key, (entries, with_desc)|
          data[key] = (entries || []).compact.map { |entry| catalog_entry(entry, with_desc) }
        end
        { 'variables' => names('var'), 'switches' => names('sw') }.each do |key, entries|
          data[key] = entries.each_with_index.map do |name, id|
            raw = name.to_s
            t_val = t_name(raw)
            entry = { 'id' => id, 'name' => t_val }
            entry['description'] = raw if t_val != raw && !raw.empty?
            entry
          end.drop(1)
        end
        { 'type' => 'edit.catalog', 'catalog' => data }
      end

      def apply(op)
        EditRuntime.apply(op)
      end

      def pump
        return unless @commands && @replies
        check_auto_reload
        NativeWebview.pump
        drain_replies
        if NativeWebview.ready? && @logs && !@logs.empty?
          entries = []
          LIMIT.times do
            entry = @logs.pop(true) rescue nil
            break unless entry
            entries << entry
          end
          dispatch_reply({ 'type' => 'log.batch', 'entries' => entries }) unless entries.empty?
        end
        16.times do
          cmd = @commands.pop(true) rescue nil
          break unless cmd
          begin
            if cmd['type'] == 'edit.map.request'
              begin
                dispatch_reply({ 'type' => 'edit.map', 'mapId' => cmd['mapId'], 'data' => MapView.detail(cmd['mapId']) })
              rescue StandardError => error
                dispatch_reply({ 'type' => 'edit.map', 'mapId' => cmd['mapId'], 'data' => { 'ok' => false, 'error' => error.message } })
              end
            elsif cmd['type'] == 'hotreload' || cmd['type'] == 'edit.reload'
              reload_plugins
              dispatch_reply({ 'type' => 'edit.reload.ack', 'ok' => true })
            elsif cmd['type'] == 'saves.cmd'
              dispatch_reply(Saves.handle(cmd))
            elsif cmd['type'] == 'edit.catalog.request'
              dispatch_reply(catalog)
            elsif cmd['type'] == 'edit.subscribe'
              dispatch_reply(full_session_state)
              dispatch_reply(catalog)
            elsif cmd['type'] == 'edit.cmd'
              fields = apply(cmd)
              dispatch_reply({ 'type' => 'edit.ack', 'cmdId' => cmd['cmdId'], 'ok' => true, 'fields' => fields })
              dispatch_reply(full_session_state)
            elsif cmd['type'] == 'overlay.open'
              ChayaRGSS.overlay_active = !!cmd['open'] if defined?(ChayaRGSS) && ChayaRGSS.respond_to?(:overlay_active=)
            elsif cmd['type'] == 'translation.dialogue.result'
              if defined?(ChayaRGSS::Translation) && ChayaRGSS::Translation.respond_to?(:handle_dialogue_result)
                ChayaRGSS::Translation.handle_dialogue_result(cmd)
              end
            end
          rescue StandardError => err
            dispatch_reply({ 'type' => 'edit.ack', 'cmdId' => cmd['cmdId'], 'ok' => false, 'error' => err.message[0, 200], 'fields' => [] })
          end
        end

        EditRuntime.tick

        # Periodic state sync (1s interval)
        now = Time.now.to_f
        if @last_state_at.nil? || (now - @last_state_at >= 1.0)
          @last_state_at = now
          state = full_session_state
          dispatch_reply(state) if state['ready']
        end
      end

      # Called when a message is received from WebView (postMessage)
      def receive_from_webview(raw_json)
        return unless @commands
        begin
          msg = raw_json.is_a?(String) ? JSON.parse(raw_json) : raw_json
          @commands << msg if msg.is_a?(Hash)
        rescue StandardError => err
          log("Invalid message from webview: #{err.message}", 'warn')
        end
      end

      # Dispatches a reply message directly to the WebView
      def dispatch_reply(message)
        return unless message
        @replies << message if @replies.size < LIMIT
        drain_replies
      end

      def drain_replies
        return unless NativeWebview.ready?
        while (reply = (@replies.pop(true) rescue nil))
          json_str = JSON.generate(reply)
          if defined?(ChayaRGSS::NativeWebview) && ChayaRGSS::NativeWebview.respond_to?(:eval_js)
            ChayaRGSS::NativeWebview.eval_js("window.__chaya_on_game_message && window.__chaya_on_game_message(" + json_str.dump + ")")
          elsif defined?(NativeWebview) && NativeWebview.respond_to?(:eval_js)
            NativeWebview.eval_js("window.__chaya_on_game_message && window.__chaya_on_game_message(" + json_str.dump + ")")
          end
        end
      end

      def reload_plugins
        root = File.dirname(__FILE__)
        ['user32.rb', 'tktk_bitmap.rb', 'mouse_movement.rb', 'map.rb', 'saves.rb', 'edit_actors.rb', 'edit_runtime.rb', 'translation_store.rb', 'data_translation.rb', 'translation.rb'].each do |file|
          path = File.join(root, file)
          load path if File.file?(path)
        end
        log('Chaya RGSS plugins reloaded')
      end

      def check_auto_reload
        return unless @reload_mtimes
        now = Time.now.to_f
        return if @last_reload_check && (now - @last_reload_check < 1.0)
        @last_reload_check = now
        root = File.dirname(__FILE__)
        changed = false
        ['user32.rb', 'tktk_bitmap.rb', 'mouse_movement.rb', 'map.rb', 'saves.rb', 'edit_actors.rb', 'edit_runtime.rb', 'translation_store.rb', 'data_translation.rb', 'translation.rb'].each do |file|
          path = File.join(root, file)
          next unless File.file?(path)
          mtime = File.mtime(path).to_f rescue 0
          if @reload_mtimes[file] && mtime > @reload_mtimes[file]
            changed = true
          end
          @reload_mtimes[file] = mtime
        end
        reload_plugins if changed
      end

      def start
        @room = ENV.fetch('CHAYA_RGSS_ROOM', 'default')
        @commands = Queue.new
        @replies = Queue.new
        @logs = Queue.new
        @reload_mtimes = {}
        root = File.dirname(__FILE__)
        ['user32.rb', 'tktk_bitmap.rb', 'mouse_movement.rb', 'map.rb', 'saves.rb', 'edit_actors.rb', 'edit_runtime.rb', 'translation_store.rb', 'data_translation.rb', 'translation.rb'].each do |file|
          path = File.join(root, file)
          @reload_mtimes[file] = File.mtime(path).to_f if File.file?(path) rescue 0
        end
        @last_reload_check = Time.now.to_f
        @last_state_at = nil
        NativeWebview.start
        # Install before the first held-confirm frame; tick alone can be a frame late.
        EditRuntime.ensure_hooks
        log("Chaya RGSS Bridge initialized for room #{@room}")
      end
    end
  end
end

class << Graphics
  unless method_defined?(:chaya_bridge_update)
    alias_method :chaya_bridge_update, :update
    def update(*args)
      ChayaRGSS::Bridge.pump
      ChayaRGSS::MouseMovement.update rescue nil
      chaya_bridge_update(*args)
    end
  end
end

ChayaRGSS::Bridge.start

