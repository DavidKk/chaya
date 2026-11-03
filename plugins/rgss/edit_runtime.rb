require_relative 'edit_actors'

module ChayaRGSS
  module EditRuntime
    SYSTEM_FLAGS ||= { 'encounter' => :encounter_disabled, 'menuEnabled' => :menu_disabled, 'saveEnabled' => :save_disabled }.freeze
    class << self
      def locks
        if !@party.equal?($game_party)
          @party = $game_party
          @locks = {}
        end
        @locks ||= {}
      end

      def item(kind, id)
        Bridge.integer(id, 1, 9999)
        database = { 'item' => $data_items, 'weapon' => $data_weapons, 'armor' => $data_armors }[kind]
        value = database && database[id]
        raise "Unknown #{kind} #{id}" unless value
        value
      end

      def counts
        result = {}
        { 'item' => $data_items, 'weapon' => $data_weapons, 'armor' => $data_armors }.each do |kind, database|
          (database || []).each_with_index do |value, id|
            result["#{kind}:#{id}"] = $game_party.item_number(value) if value && id > 0
          end
        end
        result
      end

      def run_flags
        through_val = if $game_player
                        if $game_player.respond_to?(:through?)
                          $game_player.through?
                        elsif $game_player.respond_to?(:through)
                          $game_player.through
                        else
                          $game_player.instance_variable_get(:@through)
                        end
                      else
                        false
                      end
        result = {
          'through' => !!through_val,
          'clickMove' => click_move?,
          'alwaysDash' => always_dash?,
          'autotalk' => autotalk?,
          'autoBattle' => auto_battle?,
          'autoWin' => auto_win?,
          'skipBattleResult' => skip_battle_result?
        }
        SYSTEM_FLAGS.each { |key, name| result[key] = !($game_system && $game_system.public_send(name)) }
        result
      end

      def click_move?
        @click_move != false
      end

      def always_dash?
        @always_dash != false
      end

      def autotalk?
        @autotalk == true
      end

      def auto_battle?
        @auto_battle == true
      end

      def auto_win?
        @auto_win == true
      end

      def skip_battle_result?
        @skip_battle_result != false
      end

      def set_run_flag(key, value)
        raise 'Expected boolean flag' unless value == true || value == false
        if key == 'through'
          raise 'Player is unavailable' unless $game_player
          if $game_player.respond_to?(:through=)
            $game_player.through = value
          else
            target_class = if defined?(Game_CharacterBase) && $game_player.is_a?(Game_CharacterBase)
                             Game_CharacterBase
                           elsif defined?(Game_Character) && $game_player.is_a?(Game_Character)
                             Game_Character
                           else
                             $game_player.singleton_class
                           end
            target_class.class_eval { attr_accessor :through } unless target_class.method_defined?(:through=)
            $game_player.through = value
          end
        elsif key == 'clickMove'
          @click_move = value
          ChayaRGSS::MouseMovement.interrupt if !value && defined?(ChayaRGSS::MouseMovement)
        elsif key == 'alwaysDash'
          @always_dash = value
        elsif key == 'autotalk'
          @autotalk = value
        elsif key == 'autoBattle'
          @auto_battle = value
          sync_wfrgss_auto_battle(value)
          tick_auto_battle if value
        elsif key == 'autoWin'
          @auto_win = value
          @auto_win_scene = nil unless value
          tick_auto_win if value
        elsif key == 'skipBattleResult'
          @skip_battle_result = value
          install_skip_battle_result_hook if value
        elsif SYSTEM_FLAGS.key?(key)
          raise 'Game system is unavailable' unless $game_system
          $game_system.public_send("#{SYSTEM_FLAGS[key]}=", !value)
        else
          raise "Unsupported RGSS run flag: #{key}"
        end
      end

      def lock_command(op)
        case op['op']
        when 'goldLock'
          ['gold:0', { 'op' => 'gold', 'value' => op['value'] }]
        when 'varLock', 'swLock'
          kind = op['op'] == 'varLock' ? 'var' : 'sw'
          value = kind == 'sw' ? Bridge.integer(op['value'], 0, 1) == 1 : op['value']
          ["#{kind}:#{op['id']}", { 'op' => kind, 'id' => op['id'], 'value' => value }]
        when 'countLock'
          ["#{op['kind']}:#{op['id']}", { 'op' => 'count', 'kind' => op['kind'], 'id' => op['id'], 'value' => op['value'] }]
        when 'actorVitalLock'
          kind = op['kind']
          raise 'Unsupported actor lock' unless %w[level exp hp mp].include?(kind)
          ["#{kind}:#{op['actorId']}", { 'op' => 'actor', 'id' => op['actorId'], 'patch' => { kind => op['value'] } }]
        when 'actorOwnedLock'
          kind = op['kind']
          raise 'Unsupported actor lock' unless %w[skills states].include?(kind)
          EditActors.actor(op['actorId'])
          Bridge.integer(op['entryId'], 1, 9999)
          prefix = kind == 'skills' ? 'actorSkill' : 'actorState'
          ["#{prefix}:#{op['actorId']}:#{op['entryId']}", op.dup]
        end
      end

      def enforce(command)
        if command['op'] == 'actorOwnedLock'
          actor = EditActors.actor(command['actorId'])
          kind = command['kind'].to_sym
          values = EditActors.owned(actor, kind)
          next_values = command['owned'] ? (values + [command['entryId']]).uniq : values - [command['entryId']]
          EditActors.write_owned(actor, kind, next_values) if next_values != values
        else
          write(command)
        end
      end

      def lock_values
        locks.each_with_object({}) do |(key, command), result|
          value = command['value']
          value = command['patch'].values.first if command['op'] == 'actor'
          value = command['owned'] if command['op'] == 'actorOwnedLock'
          result[key] = value == true ? 1 : value == false ? 0 : value
        end
      end

      def tick
        ensure_hooks
        tick_auto_win if auto_win?
        tick_auto_battle if auto_battle?
        tick_skip_battle_result if skip_battle_result?
        locks.each do |key, command|
          begin
            enforce(command)
          rescue StandardError => error
            locks.delete(key)
            Bridge.log("Released lock #{key}: #{error.message}", 'warn')
          end
        end
      end

      def game_speed
        @game_speed || 1.0
      end

      def apply_game_speed(rate)
        rate = [[rate.to_f, 1.0].max, 5.0].min
        @game_speed = rate
        if defined?(Graphics) && Graphics.respond_to?(:frame_rate)
          target_fps = (60 * rate).round
          Graphics.frame_rate = [target_fps, 300].min rescue 60
        end
      end

      def walk_rate
        @walk_rate || 1.0
      end

      def run_rate
        @run_rate || 1.0
      end

      def apply_walk_rate(rate)
        rate = [[rate.to_f, 0.5].max, 4.0].min
        @walk_rate = rate
        install_movement_hooks
      end

      def apply_run_rate(rate)
        rate = [[rate.to_f, 0.5].max, 4.0].min
        @run_rate = rate
        install_movement_hooks
      end

      def apply_move_rate(rate)
        rate = [[rate.to_f, 0.5].max, 4.0].min
        @walk_rate = rate
        @run_rate = rate
        install_movement_hooks
      end

      def install_movement_hooks
        return if @movement_hooks_installed
        target_class = if defined?(Game_CharacterBase)
                         Game_CharacterBase
                       elsif defined?(Game_Character)
                         Game_Character
                       end
        return unless target_class

        if target_class.method_defined?(:distance_per_frame)
          return if target_class.method_defined?(:chaya_orig_distance_per_frame)
          target_class.class_eval do
            alias_method :chaya_orig_distance_per_frame, :distance_per_frame
            def distance_per_frame
              base = chaya_orig_distance_per_frame
              return base unless defined?(ChayaRGSS::EditRuntime)

              is_player = is_a?(Game_Player)
              is_follower = defined?(Game_Follower) && is_a?(Game_Follower)
              return base unless is_player || is_follower

              is_dashing = if is_player
                             respond_to?(:dash?) && dash?
                           elsif is_follower
                             defined?($game_player) && $game_player && $game_player.respond_to?(:dash?) && $game_player.dash?
                           else
                             false
                           end
              rate = is_dashing ? ChayaRGSS::EditRuntime.run_rate : ChayaRGSS::EditRuntime.walk_rate
              rate > 0 ? base * [rate, 4.0].min : base
            end
          end
          @movement_hooks_installed = true
        elsif target_class.method_defined?(:update_move)
          return if target_class.method_defined?(:chaya_orig_update_move)
          target_class.class_eval do
            alias_method :chaya_orig_update_move, :update_move
            def update_move
              return chaya_orig_update_move unless defined?(ChayaRGSS::EditRuntime) && is_a?(Game_Player)

              rate = (respond_to?(:dash?) && dash?) ? ChayaRGSS::EditRuntime.run_rate : ChayaRGSS::EditRuntime.walk_rate
              if rate == 1.0
                chaya_orig_update_move
              else
                distance = 2 ** @move_speed
                distance *= 2 if @dash
                distance = [(distance * [rate, 4.0].min).round, 256].min
                @real_x = [@real_x - distance, @x * 256].max if @x * 256 < @real_x
                @real_x = [@real_x + distance, @x * 256].min if @x * 256 > @real_x
                @real_y = [@real_y - distance, @y * 256].max if @y * 256 < @real_y
                @real_y = [@real_y + distance, @y * 256].min if @y * 256 > @real_y
                @anime_count += 1
              end
            end
          end
          @movement_hooks_installed = true
        end
      end

      def ensure_hooks
        install_selectable_hook if defined?(Window_Selectable)
        install_battle_command_guards if defined?(Scene_Battle)
        install_skip_battle_result_hook if skip_battle_result?
        install_movement_hooks if defined?(Game_CharacterBase) || defined?(Game_Character)
        return if @hooks_installed
        install_dash_hook if defined?(Game_Player) || (defined?($game_player) && $game_player)
        install_message_hook if defined?(Window_Message)
        install_battle_hooks if defined?(Game_Actor) || (defined?($game_actors) && $game_actors) || defined?(BattleManager)
        @hooks_installed = true if defined?(Game_Player) && defined?(Window_Message) && (defined?(BattleManager) || defined?(Scene_Battle))
      end

      # Mash confirm only while MOG result flags are live — not during command select.
      # Do not key off Scene_Battle@result: it stays non-nil after dispose and would
      # keep synthesizing Enter into the next fight (on_enemy_ok → nil.index).
      def battle_result_context?
        return false unless defined?($game_temp) && $game_temp
        battle_end = $game_temp.respond_to?(:battle_end) && $game_temp.battle_end
        result = $game_temp.respond_to?(:result) && $game_temp.result
        battle_end && result
      end

      def result_confirm_key?(key)
        return true if key == :C || key == :ok
        return true if defined?(Input::C) && key == Input::C
        false
      end

      def install_skip_battle_result_hook
        return unless defined?(Input) && Input.respond_to?(:trigger?)
        input_meta = class << Input; self; end
        return if input_meta.method_defined?(:chaya_skip_battle_result_trigger?)
        input_meta.class_eval do
          alias_method :chaya_skip_battle_result_trigger?, :trigger?
          def trigger?(*args)
            key = args[0]
            if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.skip_battle_result? &&
               ChayaRGSS::EditRuntime.battle_result_context? &&
               ChayaRGSS::EditRuntime.result_confirm_key?(key)
              now = Time.now.to_f
              next_at = ChayaRGSS::EditRuntime.instance_variable_get(:@skip_result_next_at).to_f
              if now >= next_at
                ChayaRGSS::EditRuntime.instance_variable_set(:@skip_result_next_at, now + 0.1)
                return true
              end
            end
            chaya_skip_battle_result_trigger?(*args)
          end
        end
      end

      def tick_skip_battle_result
        install_skip_battle_result_hook
      end

      # LNX horizontal party command uses col_max = @list.size; empty list → 0 → ZeroDivisionError on confirm.
      def install_selectable_hook
        return unless defined?(Window_Selectable)
        return if Window_Selectable.method_defined?(:chaya_safe_col_max)
        Window_Selectable.class_eval do
          def chaya_safe_col_max
            cols = col_max
            cols < 1 ? 1 : cols
          end
          alias_method :chaya_orig_item_width, :item_width if method_defined?(:item_width)
          def item_width
            (width - standard_padding * 2 + spacing) / chaya_safe_col_max - spacing
          end
          alias_method :chaya_orig_row_max, :row_max if method_defined?(:row_max)
          def row_max
            [(item_max + chaya_safe_col_max - 1) / chaya_safe_col_max, 1].max
          end
          alias_method :chaya_orig_row, :row if method_defined?(:row)
          def row
            index / chaya_safe_col_max
          end
          alias_method :chaya_orig_item_rect, :item_rect if method_defined?(:item_rect)
          def item_rect(index)
            rect = Rect.new
            rect.width = item_width
            rect.height = item_height
            cols = chaya_safe_col_max
            rect.x = index % cols * (item_width + spacing)
            rect.y = index / cols * item_height
            rect
          end
        end
      end

      def install_dash_hook
        target = if defined?(Game_Player)
                   Game_Player
                 elsif defined?($game_player) && $game_player
                   $game_player.class
                 end
        return unless target && target.method_defined?(:dash?)
        return if target.method_defined?(:chaya_orig_dash?)
        target.class_eval do
          alias_method :chaya_orig_dash?, :dash?
          def dash?
            return false if @move_route_forcing
            return false if defined?($game_map) && $game_map && $game_map.respond_to?(:disable_dash?) && $game_map.disable_dash?
            return false if respond_to?(:in_vehicle?) && in_vehicle?
            return true if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.always_dash?
            chaya_orig_dash?
          end
        end
      end

      def install_message_hook
        return unless defined?(Window_Message)
        if Window_Message.method_defined?(:input_pause) && !Window_Message.method_defined?(:chaya_orig_input_pause)
          Window_Message.class_eval do
            alias_method :chaya_orig_input_pause, :input_pause
            def input_pause
              if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.autotalk?
                self.pause = true
                auto_count = 8
                until (defined?(Input) && (Input.trigger?(:B) || Input.trigger?(:C))) || auto_count <= 0
                  auto_count -= 1
                  Fiber.yield
                end
                Input.update if defined?(Input)
                self.pause = false
              else
                chaya_orig_input_pause
              end
            end
          end
        end
        if Window_Message.method_defined?(:update_show_fast) && !Window_Message.method_defined?(:chaya_orig_update_show_fast)
          Window_Message.class_eval do
            alias_method :chaya_orig_update_show_fast, :update_show_fast
            def update_show_fast
              if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.autotalk?
                @show_fast = true
              else
                chaya_orig_update_show_fast
              end
            end
          end
        end
        if !Window_Message.method_defined?(:input_pause) && Window_Message.method_defined?(:update) && !Window_Message.method_defined?(:chaya_orig_msg_update)
          Window_Message.class_eval do
            alias_method :chaya_orig_msg_update, :update
            def update
              if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.autotalk? && pause
                @chaya_auto_wait = (@chaya_auto_wait || 10) - 1
                if @chaya_auto_wait <= 0
                  @chaya_auto_wait = 10
                  self.pause = false
                end
              else
                @chaya_auto_wait = nil
              end
              chaya_orig_msg_update
            end
          end
        end
        # L(2)'s message-hide command calls @talker_name_window.hide; after auto-win
        # teardown that child can already be disposed on the next battle.
        if Window_Message.method_defined?(:update_window_hide) && !Window_Message.method_defined?(:chaya_orig_update_window_hide)
          Window_Message.class_eval do
            alias_method :chaya_orig_update_window_hide, :update_window_hide
            def update_window_hide(*args)
              return if respond_to?(:disposed?) && disposed?
              if instance_variable_defined?(:@talker_name_window)
                talker = @talker_name_window
                @talker_name_window = nil if talker && talker.respond_to?(:disposed?) && talker.disposed?
              end
              chaya_orig_update_window_hide(*args)
            rescue RGSSError
              nil
            end
          end
        end
      end

      # Wait until command/turn phases; winning during :init disposes windows mid-setup.
      AUTO_WIN_PHASES ||= [:input, :turn, :turn_end, :action].freeze

      def sync_wfrgss_auto_battle(value)
        return unless defined?(AutoBattle) && AutoBattle.respond_to?(:auto_set=)
        AutoBattle.auto_set = value
      rescue StandardError
        nil
      end

      def battle_message_busy?
        defined?($game_message) && $game_message && $game_message.respond_to?(:busy?) && $game_message.busy?
      end

      def troop_event_running?
        defined?($game_troop) && $game_troop && $game_troop.respond_to?(:interpreter) &&
          $game_troop.interpreter && $game_troop.interpreter.respond_to?(:running?) && $game_troop.interpreter.running?
      end

      def safe_auto_win_phase?(phase)
        return true if phase.nil?
        AUTO_WIN_PHASES.include?(phase)
      end

      def live_battle_scene
        return nil unless defined?(Scene_Battle)
        scene = if defined?(SceneManager) && SceneManager.respond_to?(:scene)
                  SceneManager.scene rescue nil
                elsif defined?($scene)
                  $scene
                end
        scene.is_a?(Scene_Battle) ? scene : nil
      end

      def window_usable?(win)
        win && (!win.respond_to?(:disposed?) || !win.disposed?)
      end

      def close_battle_windows(scene)
        return unless scene
        [:@party_command_window, :@actor_command_window, :@skill_window, :@item_window,
         :@actor_window, :@enemy_window, :@target_window, :@help_window].each do |var|
          win = scene.instance_variable_get(var) rescue nil
          next unless window_usable?(win)
          win.close if win.respond_to?(:close)
          win.deactivate if win.respond_to?(:deactivate)
        end
      end

      def install_battle_hooks
        actor_class = if defined?(Game_Actor)
                        Game_Actor
                      elsif defined?($game_actors) && $game_actors && $game_actors[1]
                        $game_actors[1].class
                      end
        # Some battle scripts (e.g. WFRGSS AutoBattle) redefine auto_battle?(action = true)
        # and call auto_battle?(false); forward *args so arity stays compatible.
        if actor_class && actor_class.method_defined?(:auto_battle?) && !actor_class.method_defined?(:chaya_orig_auto_battle?)
          actor_class.class_eval do
            alias_method :chaya_orig_auto_battle?, :auto_battle?
            def auto_battle?(*args)
              return true if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.auto_battle?
              chaya_orig_auto_battle?(*args)
            end
          end
        end
        if actor_class && actor_class.method_defined?(:make_auto_battle_actions) && !actor_class.method_defined?(:chaya_orig_make_auto_battle_actions)
          actor_class.class_eval do
            alias_method :chaya_orig_make_auto_battle_actions, :make_auto_battle_actions
            def make_auto_battle_actions
              if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.auto_battle?
                ChayaRGSS::EditRuntime.smart_auto_battle_actions(self)
              else
                chaya_orig_make_auto_battle_actions
              end
            end
          end
        end
        install_battle_command_guards
        if defined?(BattleManager)
          bm_meta = class << BattleManager; self; end
          if BattleManager.respond_to?(:setup) && !bm_meta.method_defined?(:chaya_orig_setup)
            bm_meta.class_eval do
              alias_method :chaya_orig_setup, :setup
              def setup(*args)
                ChayaRGSS::EditRuntime.record_pre_battle_vitals if defined?(ChayaRGSS::EditRuntime)
                chaya_orig_setup(*args)
              end
            end
          end
          if BattleManager.respond_to?(:battle_end) && !bm_meta.method_defined?(:chaya_orig_battle_end)
            bm_meta.class_eval do
              alias_method :chaya_orig_battle_end, :battle_end
              def battle_end(*args)
                ChayaRGSS::EditRuntime.restore_pre_battle_vitals if defined?(ChayaRGSS::EditRuntime)
                chaya_orig_battle_end(*args)
              end
            end
          end
          if BattleManager.respond_to?(:judge_win_loss) && !bm_meta.method_defined?(:chaya_orig_judge_win_loss)
            bm_meta.class_eval do
              alias_method :chaya_orig_judge_win_loss, :judge_win_loss
              def judge_win_loss
                if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.auto_win_ready?
                  return ChayaRGSS::EditRuntime.finish_auto_win
                end
                chaya_orig_judge_win_loss
              end
            end
          end
        end
        if defined?(Scene_Battle) && Scene_Battle.method_defined?(:terminate) && !Scene_Battle.method_defined?(:chaya_orig_terminate)
          Scene_Battle.class_eval do
            alias_method :chaya_orig_terminate, :terminate
            def terminate(*args)
              ChayaRGSS::EditRuntime.restore_pre_battle_vitals if defined?(ChayaRGSS::EditRuntime)
              chaya_orig_terminate(*args)
            end
          end
        end
      end

      # Holding Enter / empty enemy list: stock on_enemy_ok does enemy.index on nil.
      def install_battle_command_guards
        return unless defined?(Scene_Battle)
        return if Scene_Battle.method_defined?(:chaya_orig_on_enemy_ok)
        Scene_Battle.class_eval do
          if method_defined?(:on_enemy_ok)
            alias_method :chaya_orig_on_enemy_ok, :on_enemy_ok
            def on_enemy_ok(*args)
              enemy = @enemy_window.respond_to?(:enemy) ? @enemy_window.enemy : nil
              actor = BattleManager.respond_to?(:actor) ? BattleManager.actor : nil
              input = actor && actor.respond_to?(:input) ? actor.input : nil
              if enemy.nil? || input.nil? || !enemy.respond_to?(:index)
                on_enemy_cancel(*args) if respond_to?(:on_enemy_cancel)
                return
              end
              chaya_orig_on_enemy_ok(*args)
            end
          end
          if method_defined?(:on_actor_ok)
            alias_method :chaya_orig_on_actor_ok, :on_actor_ok
            def on_actor_ok(*args)
              actor = BattleManager.respond_to?(:actor) ? BattleManager.actor : nil
              input = actor && actor.respond_to?(:input) ? actor.input : nil
              index = @actor_window.respond_to?(:index) ? @actor_window.index : nil
              if input.nil? || index.nil? || index < 0
                on_actor_cancel(*args) if respond_to?(:on_actor_cancel)
                return
              end
              chaya_orig_on_actor_ok(*args)
            end
          end
        end
      end

      def auto_win_ready?
        return false if @resolving_auto_win || @resolving_action || !auto_win?
        scene = live_battle_scene
        return false unless scene
        return false if scene.equal?(@auto_win_scene)
        return false if troop_event_running? || battle_message_busy?
        return false unless defined?($game_troop) && $game_troop && !$game_troop.members.empty?
        phase = BattleManager.instance_variable_get(:@phase) rescue nil
        safe_auto_win_phase?(phase)
      end

      def finish_auto_win
        return false if @resolving_auto_win
        scene = live_battle_scene
        return false unless scene && defined?($game_troop) && $game_troop
        begin
          @resolving_auto_win = true
          $game_troop.members.each { |enemy| enemy.hp = 0 if enemy.respond_to?(:hp=) }
          close_battle_windows(scene)
          result = if defined?(BattleManager) && BattleManager.respond_to?(:process_victory)
                     BattleManager.process_victory
                   elsif scene.respond_to?(:process_victory)
                     scene.process_victory
                   elsif scene.respond_to?(:battle_end)
                     scene.battle_end(0)
                   end
          @auto_win_scene = scene
          result
        ensure
          @resolving_auto_win = false
        end
      end

      def execute_battle_victory
        return false if @resolving_action || @resolving_auto_win
        scene = live_battle_scene
        return false unless scene && defined?($game_troop) && $game_troop
        return false if troop_event_running? || battle_message_busy?
        phase = BattleManager.instance_variable_get(:@phase) rescue nil if defined?(BattleManager)
        return false if defined?(BattleManager) && !safe_auto_win_phase?(phase)

        begin
          @resolving_action = true
          $game_troop.members.each { |enemy| enemy.hp = 0 if enemy.respond_to?(:hp=) }
          close_battle_windows(scene)
          if defined?(BattleManager) && BattleManager.respond_to?(:process_victory)
            BattleManager.process_victory
          elsif scene.respond_to?(:process_victory)
            scene.process_victory
          elsif scene.respond_to?(:battle_end)
            scene.battle_end(0)
          end
          @auto_win_scene = scene
          true
        ensure
          @resolving_action = false
        end
      end

      def execute_battle_escape
        scene = live_battle_scene
        return false unless scene
        close_battle_windows(scene)
        if defined?(BattleManager) && BattleManager.respond_to?(:process_abort)
          if defined?(Vocab::EscapeStart) && defined?($game_party) && defined?($game_message)
            $game_message.add(sprintf(Vocab::EscapeStart, $game_party.name)) rescue nil
          end
          BattleManager.process_abort
          true
        elsif scene.respond_to?(:battle_end)
          scene.battle_end(1)
          true
        else
          false
        end
      end

      def execute_battle_defeat
        scene = live_battle_scene
        return false unless scene && defined?($game_party) && $game_party
        $game_party.members.each { |m| m.hp = 0 if m.respond_to?(:hp=) }
        close_battle_windows(scene)
        if defined?(BattleManager) && BattleManager.respond_to?(:process_defeat)
          BattleManager.process_defeat
        elsif scene.respond_to?(:battle_end)
          scene.battle_end(2)
        end
        true
      end

      def execute_battle_abort
        scene = live_battle_scene
        return false unless scene
        close_battle_windows(scene)
        if defined?(BattleManager) && BattleManager.respond_to?(:process_abort)
          BattleManager.process_abort
          true
        elsif scene.respond_to?(:battle_end)
          scene.battle_end(1)
          true
        else
          false
        end
      end

      def execute_battle_enemy_hp1
        return false unless defined?($game_troop) && $game_troop
        $game_troop.members.each do |enemy|
          next unless enemy.respond_to?(:hp) && enemy.respond_to?(:hp=)
          enemy.hp = 1 if enemy.hp > 0
        end
        true
      end

      def execute_battle_party_heal
        mark_battle_vital_overridden
        return false unless defined?($game_party) && $game_party
        $game_party.members.each do |actor|
          if actor.respond_to?(:recover_all)
            actor.recover_all
          else
            max_hp = if actor.respond_to?(:mhp) then actor.mhp
                     elsif actor.respond_to?(:maxhp) then actor.maxhp
                     end
            max_mp = if actor.respond_to?(:mmp) then actor.mmp
                     elsif actor.respond_to?(:maxmp) then actor.maxmp
                     end
            actor.hp = max_hp if actor.respond_to?(:hp=) && max_hp
            actor.mp = max_mp if actor.respond_to?(:mp=) && max_mp
          end
        end
        true
      end

      def execute_battle_party_hp1
        mark_battle_vital_overridden
        return false unless defined?($game_party) && $game_party
        $game_party.members.each do |actor|
          next unless actor.respond_to?(:hp) && actor.respond_to?(:hp=)
          actor.hp = 1 if actor.hp > 0
        end
        true
      end

      def execute_battle_party_hp0
        mark_battle_vital_overridden
        return false unless defined?($game_party) && $game_party
        $game_party.members.each do |actor|
          actor.hp = 0 if actor.respond_to?(:hp=)
        end
        true
      end

      def record_pre_battle_vitals
        @pre_battle_vitals = {}
        @has_battle_vital_overrides = false
        if defined?($game_party) && $game_party && $game_party.respond_to?(:members)
          $game_party.members.each do |m|
            next unless m.respond_to?(:id) && m.respond_to?(:hp)
            @pre_battle_vitals[m.id] = {
              :hp => m.hp,
              :mp => m.respond_to?(:mp) ? m.mp : 0,
              :tp => m.respond_to?(:tp) ? m.tp : 0
            }
          end
        end
      end

      def mark_battle_vital_overridden
        record_pre_battle_vitals if @pre_battle_vitals.nil? || @pre_battle_vitals.empty?
        @has_battle_vital_overrides = true
      end

      def restore_pre_battle_vitals
        return unless @has_battle_vital_overrides && @pre_battle_vitals
        if defined?($game_party) && $game_party && $game_party.respond_to?(:members)
          $game_party.members.each do |m|
            next unless m.respond_to?(:id)
            snap = @pre_battle_vitals[m.id]
            next unless snap
            m.hp = snap[:hp] if m.respond_to?(:hp=)
            m.mp = snap[:mp] if m.respond_to?(:mp=)
            m.tp = snap[:tp] if m.respond_to?(:tp=)
          end
        end
        @pre_battle_vitals = {}
        @has_battle_vital_overrides = false
      end

      def goto_scene(cls)
        return false unless cls
        if defined?(SceneManager) && SceneManager.respond_to?(:goto)
          SceneManager.goto(cls)
          true
        elsif defined?($scene)
          $scene = cls.new rescue nil
          true
        else
          false
        end
      end

      def execute_fix_map
        defined?(Scene_Map) && goto_scene(Scene_Map)
      end

      def execute_fix_title
        defined?(Scene_Title) && goto_scene(Scene_Title)
      end

      def execute_fix_clear_event
        if defined?($game_map) && $game_map
          interp = $game_map.respond_to?(:interpreter) ? $game_map.interpreter : $game_map.instance_variable_get(:@interpreter)
          interp.clear if interp && interp.respond_to?(:clear)
        end
        $game_message.clear if defined?($game_message) && $game_message.respond_to?(:clear)
        $game_player.clear_move_route if defined?($game_player) && $game_player.respond_to?(:clear_move_route)
        true
      end

      def execute_fix_clear_move_route
        $game_player.clear_move_route if defined?($game_player) && $game_player.respond_to?(:clear_move_route)
        if defined?($game_map) && $game_map && $game_map.respond_to?(:events)
          $game_map.events.values.each { |ev| ev.clear_move_route if ev.respond_to?(:clear_move_route) }
        end
        true
      end

      def execute_fix_close_windows
        scene = if defined?(SceneManager) && SceneManager.respond_to?(:scene)
                  SceneManager.scene rescue nil
                elsif defined?($scene)
                  $scene
                end
        return false unless scene
        scene.instance_variables.each do |var|
          val = scene.instance_variable_get(var) rescue nil
          next unless window_usable?(val)
          val.close if val.respond_to?(:close)
          val.deactivate if val.respond_to?(:deactivate)
        end
        true
      end

      def execute_fix_fade_in
        if defined?(Graphics) && Graphics.respond_to?(:fadein)
          Graphics.fadein(1) rescue nil
          true
        else
          false
        end
      end

      def handle_run_action(id)
        case id
        when 'battle:victory' then execute_battle_victory
        when 'battle:escape' then execute_battle_escape
        when 'battle:defeat' then execute_battle_defeat
        when 'battle:abort' then execute_battle_abort
        when 'battle:enemyHp1' then execute_battle_enemy_hp1
        when 'battle:partyHeal' then execute_battle_party_heal
        when 'battle:partyHp1' then execute_battle_party_hp1
        when 'battle:partyHp0' then execute_battle_party_hp0
        when 'fix:map' then execute_fix_map
        when 'fix:title' then execute_fix_title
        when 'fix:clearEvent' then execute_fix_clear_event
        when 'fix:clearMoveRoute' then execute_fix_clear_move_route
        when 'fix:closeWindows' then execute_fix_close_windows
        when 'fix:fadeIn' then execute_fix_fade_in
        when 'scene:item' then goto_scene(defined?(Scene_Item) ? Scene_Item : nil)
        when 'scene:skill' then goto_scene(defined?(Scene_Skill) ? Scene_Skill : nil)
        when 'scene:equip' then goto_scene(defined?(Scene_Equip) ? Scene_Equip : nil)
        when 'scene:save' then goto_scene(defined?(Scene_Save) ? Scene_Save : nil)
        when 'scene:menu' then goto_scene(defined?(Scene_Menu) ? Scene_Menu : nil)
        when 'scene:load' then goto_scene(defined?(Scene_Load) ? Scene_Load : nil)
        when 'scene:status' then goto_scene(defined?(Scene_Status) ? Scene_Status : nil)
        when 'scene:debug' then goto_scene(defined?(Scene_Debug) ? Scene_Debug : nil)
        else
          raise "Unsupported RGSS run action: #{id}"
        end
      end

      def tick_auto_win
        return unless auto_win_ready?
        finish_auto_win
      end

      def tick_auto_battle
        # Auto-win owns the encounter; running both force-starts a turn that
        # tears windows down underneath victory / message scripts.
        return unless auto_battle? && !auto_win?
        scene = live_battle_scene
        return unless scene
        return if troop_event_running? || battle_message_busy?
        phase = BattleManager.instance_variable_get(:@phase) rescue nil
        return unless phase == :input
        if defined?($game_party) && $game_party.respond_to?(:battle_members)
          $game_party.battle_members.each do |actor|
            next unless actor
            next if actor.respond_to?(:movable?) && !actor.movable?
            if actor.respond_to?(:make_auto_battle_actions)
              actor.make_auto_battle_actions
            else
              smart_auto_battle_actions(actor)
            end
          end
        end
        [:@party_command_window, :@actor_command_window].each do |var|
          win = scene.instance_variable_get(var) rescue nil
          next unless window_usable?(win)
          win.deactivate if win.respond_to?(:deactivate)
        end
        BattleManager.start_turn if BattleManager.respond_to?(:start_turn)
      end

      def smart_auto_battle_actions(actor)
        return unless actor
        if actor.respond_to?(:confusion?) && actor.confusion?
          actor.make_confusion_actions if actor.respond_to?(:make_confusion_actions)
          return
        end
        action_count = 1
        if actor.respond_to?(:current_action_num)
          action_count = actor.current_action_num
        elsif actor.respond_to?(:actions) && actor.actions.is_a?(Array)
          action_count = actor.actions.size
        end
        action_count = 1 if action_count < 1

        virtual_mp = actor.respond_to?(:mp) ? actor.mp : 9999
        virtual_tp = actor.respond_to?(:tp) ? actor.tp : 9999
        virtual_items = Hash.new(0)

        action_count.times do |i|
          act = select_smart_action_rgss(actor, virtual_mp, virtual_tp, virtual_items)
          if act
            item_or_skill = (act.item rescue nil)
            if item_or_skill && (item_or_skill.is_a?(RPG::Skill) rescue false)
              mp_cost = actor.respond_to?(:skill_mp_cost) ? actor.skill_mp_cost(item_or_skill) : (item_or_skill.mp_cost rescue 0)
              tp_cost = actor.respond_to?(:skill_tp_cost) ? actor.skill_tp_cost(item_or_skill) : (item_or_skill.tp_cost rescue 0)
              virtual_mp -= mp_cost
              virtual_tp -= tp_cost
            elsif item_or_skill && (item_or_skill.is_a?(RPG::Item) rescue false)
              virtual_items[item_or_skill.id] += 1
            elsif act.respond_to?(:item_id) && act.item_id
              virtual_items[act.item_id] += 1
            end
            if actor.respond_to?(:set_action)
              actor.set_action(i, act)
            elsif actor.respond_to?(:actions) && actor.actions.is_a?(Array)
              actor.actions[i] = act
            end
          end
        end
        actor.action_state = :waiting if actor.respond_to?(:action_state=)
      rescue StandardError
        actor.chaya_orig_make_auto_battle_actions if actor.respond_to?(:chaya_orig_make_auto_battle_actions)
      end

      # RGSS/VX/VX Ace expose a one-argument method; some plugin builds add
      # a second critical flag. Pick the call shape from the method arity so
      # a strict one-argument implementation is not silently estimated as 0.
      def make_damage_value_rgss(action, target)
        return 0 unless action && target
        method = action.method(:make_damage_value)
        value = method.arity == 1 ? action.make_damage_value(target) : action.make_damage_value(target, false)
        value.is_a?(Numeric) ? value : 0
      rescue StandardError
        0
      end

      def estimate_hp_recovery_rgss(item, user, target)
        return 0 unless item && target
        total = 0
        if item.respond_to?(:damage) && item.damage.respond_to?(:type) && item.damage.type == 3
          act = (Game_Action.new(user) rescue nil)
          if act
            if (item.is_a?(RPG::Skill) rescue false) || item.respond_to?(:stype_id)
              act.set_skill(item.id) rescue nil
            else
              act.set_item(item.id) rescue nil
            end
            val = make_damage_value_rgss(act, target)
            total += val if val > 0
          end
        end
        if item.respond_to?(:effects) && item.effects.is_a?(Array)
          item.effects.each do |eff|
            if eff.respond_to?(:code) && eff.code == 11
              pct = eff.respond_to?(:value1) ? eff.value1.to_f : 0.0
              flat = eff.respond_to?(:value2) ? eff.value2.to_i : 0
              total += (((target.mhp rescue 1) || 1) * pct + flat).round
            end
          end
        end
        total
      end

      def estimate_mp_recovery_rgss(item, user, target)
        return 0 unless item && target
        total = 0
        if item.respond_to?(:damage) && item.damage.respond_to?(:type) && item.damage.type == 4
          act = (Game_Action.new(user) rescue nil)
          if act
            act.set_item(item.id) rescue nil
            val = make_damage_value_rgss(act, target)
            total += val if val > 0
          end
        end
        if item.respond_to?(:effects) && item.effects.is_a?(Array)
          item.effects.each do |eff|
            if eff.respond_to?(:code) && eff.code == 12
              pct = eff.respond_to?(:value1) ? eff.value1.to_f : 0.0
              flat = eff.respond_to?(:value2) ? eff.value2.to_i : 0
              total += (((target.mmp rescue 1) || 1) * pct + flat).round
            end
          end
        end
        total
      end

      def match_best_healing_item_rgss(usable_items, user, target)
        return nil if usable_items.empty? || !target
        target_mhp = [(target.mhp rescue 1), 1].max
        target_hp = target.hp rescue 0
        deficit = [target_mhp - target_hp, 1].max
        is_self = (target == user) || (target.respond_to?(:index) && user.respond_to?(:index) && target.index == user.index)

        best_item = nil
        best_score = -1.0

        usable_items.each do |item|
          scope = item.respond_to?(:scope) ? item.scope : 7
          next unless [7, 8, 11].include?(scope)
          next if scope == 11 && !is_self
          recovery = estimate_hp_recovery_rgss(item, user, target)
          next if recovery <= 0

          # Skip obsolete healing items below 8% MHP and 20% of a deficit greater than 300.
          if recovery < target_mhp * 0.08 && deficit > 300 && recovery < deficit * 0.2
            next
          end

          score = if recovery <= deficit
                    recovery.to_f / deficit
                  else
                    overflow = recovery - deficit
                    [0.1, 1.0 - (overflow.to_f / recovery) * 0.5].max
                  end

          if score > best_score
            best_score = score
            best_item = item
          end
        end
        best_item
      end
      def select_smart_action_rgss(actor, available_mp, available_tp, virtual_items = {})
        act = if defined?(Game_Action)
                Game_Action.new(actor)
              elsif actor.respond_to?(:current_action) && actor.current_action
                actor.current_action
              end
        return act unless act

        can_attack = actor.respond_to?(:attack_usable?) ? actor.attack_usable? : true
        can_guard = actor.respond_to?(:guard_usable?) ? actor.guard_usable? : true

        usable_skills = []
        if actor.respond_to?(:usable_skills)
          usable_skills = actor.usable_skills.select do |s|
            next false unless s
            mp_c = actor.respond_to?(:skill_mp_cost) ? actor.skill_mp_cost(s) : (s.mp_cost rescue 0)
            tp_c = actor.respond_to?(:skill_tp_cost) ? actor.skill_tp_cost(s) : (s.tp_cost rescue 0)
            mp_c <= available_mp && tp_c <= available_tp
          end
        end

        usable_items = []
        if defined?($game_party) && $game_party.respond_to?(:items)
          $game_party.items.each do |item|
            next unless item
            can_use = actor.respond_to?(:usable?) ? actor.usable?(item) : true
            total_n = ($game_party.item_number(item) rescue 1)
            used_n = (virtual_items && virtual_items[item.id]) ? virtual_items[item.id].to_i : 0
            usable_items << item if can_use && (total_n - used_n) > 0
          end
        end

        alive_allies = defined?($game_party) && $game_party.respond_to?(:alive_members) ? $game_party.alive_members : []
        dead_allies = defined?($game_party) && $game_party.respond_to?(:dead_members) ? $game_party.dead_members : []
        alive_enemies = defined?($game_troop) && $game_troop.respond_to?(:alive_members) ? $game_troop.alive_members : []

        # 1. Revive fallen allies, preferring skills over items.
        if !dead_allies.empty?
          revive = usable_skills.find { |s| s.respond_to?(:scope) && [9, 10].include?(s.scope) }
          if revive
            act.set_skill(revive.id) if act.respond_to?(:set_skill)
            first_dead = dead_allies.first
            act.target_index = first_dead.index if act.respond_to?(:target_index=) && first_dead.respond_to?(:index)
            return act
          end
          revive_item = usable_items.find { |i| i.respond_to?(:scope) && [9, 10].include?(i.scope) }
          if revive_item
            act.set_item(revive_item.id) if act.respond_to?(:set_item)
            first_dead = dead_allies.first
            act.target_index = first_dead.index if act.respond_to?(:target_index=) && first_dead.respond_to?(:index)
            return act
          end
        end

        # 2. Heal allies below 40% HP, preferring skills before matching item recovery.
        lowest_ally = nil
        lowest_rate = 1.0
        if !alive_allies.empty?
          lowest_ally = alive_allies.min_by { |a| a.hp.to_f / [a.mhp, 1].max } rescue nil
          lowest_rate = lowest_ally ? (lowest_ally.hp.to_f / [lowest_ally.mhp, 1].max) : 1.0
          if lowest_rate < 0.4
            is_self = (lowest_ally == actor) || (lowest_ally.respond_to?(:index) && actor.respond_to?(:index) && lowest_ally.index == actor.index)
            heal = usable_skills.find do |s|
              next false unless s
              next false if s.respond_to?(:scope) && s.scope == 11 && !is_self
              rec = estimate_hp_recovery_rgss(s, actor, lowest_ally)
              rec > 0 || (s.respond_to?(:damage) && s.damage.respond_to?(:type) && s.damage.type == 3)
            end rescue nil
            if heal
              act.set_skill(heal.id) if act.respond_to?(:set_skill)
              act.target_index = lowest_ally.index if act.respond_to?(:target_index=) && lowest_ally.respond_to?(:index)
              return act
            end
            heal_item = match_best_healing_item_rgss(usable_items, actor, lowest_ally)
            if heal_item
              act.set_item(heal_item.id) if act.respond_to?(:set_item)
              act.target_index = lowest_ally.index if act.respond_to?(:target_index=) && lowest_ally.respond_to?(:index)
              return act
            end
          end
        end

        # 2.5. Sustain MP with recovery items.
        cur_mp = actor.respond_to?(:mp) ? actor.mp : 100
        max_mp = [actor.respond_to?(:mmp) ? actor.mmp : 100, 1].max
        learned_skills = actor.respond_to?(:skills) ? actor.skills : usable_skills
        has_mp_skills = learned_skills.any? do |s|
          next false unless s
          mp_c = actor.respond_to?(:skill_mp_cost) ? actor.skill_mp_cost(s) : (s.mp_cost rescue 0)
          mp_c > 0
        end
        if cur_mp.to_f / max_mp < 0.25 && has_mp_skills && lowest_rate >= 0.4
          mp_item = usable_items.find do |item|
            scope = item.respond_to?(:scope) ? item.scope : 7
            [7, 11].include?(scope) && estimate_mp_recovery_rgss(item, actor, actor) > 0
          end
          if mp_item
            act.set_item(mp_item.id) if act.respond_to?(:set_item)
            act.target_index = actor.index if act.respond_to?(:target_index=) && actor.respond_to?(:index)
            return act
          end
        end

        # 3. Use area attacks against at least two living enemies.
        if alive_enemies.size >= 2
          aoe = usable_skills.find do |s|
            s.respond_to?(:scope) && s.scope == 2 && s.respond_to?(:damage) && s.damage.respond_to?(:type) && [1, 5].include?(s.damage.type)
          end rescue nil
          if aoe
            act.set_skill(aoe.id) if act.respond_to?(:set_skill)
            act.target_index = 0 if act.respond_to?(:target_index=)
            return act
          end
        end

        # 4. Focus single-target damage on enemies with the lowest HP.
        focus_enemy = alive_enemies.min_by { |e| e.hp } rescue alive_enemies.first
        best_skill = nil
        best_score = 0
        best_target = focus_enemy

        usable_skills.each do |skill|
          next unless skill.respond_to?(:damage) && skill.damage.respond_to?(:type) && [1, 5].include?(skill.damage.type)
          test_act = (Game_Action.new(actor) rescue nil)
          next unless test_act && test_act.respond_to?(:set_skill)
          test_act.set_skill(skill.id) rescue next
          alive_enemies.each do |enemy|
            val = make_damage_value_rgss(test_act, enemy)
            score = val.to_f + (val >= enemy.hp && enemy.hp > 0 ? 10000 : 0)
            if score > best_score
              best_score = score
              best_skill = skill
              best_target = enemy
            end
          end
        end

        attack_dmg = 0
        if can_attack && focus_enemy
          test_atk = (Game_Action.new(actor) rescue nil)
          if test_atk && test_atk.respond_to?(:set_attack)
            test_atk.set_attack
            attack_dmg = make_damage_value_rgss(test_atk, focus_enemy)
          end
        end

        if best_skill && (!can_attack || best_score >= 10000 || best_score > attack_dmg * 1.15)
          act.set_skill(best_skill.id) if act.respond_to?(:set_skill)
          act.target_index = best_target.index if act.respond_to?(:target_index=) && best_target.respond_to?(:index)
          return act
        end

        if can_attack && focus_enemy
          act.set_attack if act.respond_to?(:set_attack)
          act.target_index = focus_enemy.index if act.respond_to?(:target_index=) && focus_enemy.respond_to?(:index)
          return act
        end

        # 5. Use attack items when disarmed.
        if !can_attack && focus_enemy
          throw_item = usable_items.find do |i|
            scope = i.respond_to?(:scope) ? i.scope : 1
            [1, 2].include?(scope) && i.respond_to?(:damage) && i.damage.respond_to?(:type) && [1, 5].include?(i.damage.type)
          end
          if throw_item
            act.set_item(throw_item.id) if act.respond_to?(:set_item)
            act.target_index = focus_enemy.index if act.respond_to?(:target_index=) && focus_enemy.respond_to?(:index)
            return act
          end
        end

        # 6. Use other available skills, such as buffs or debuffs, when disarmed.
        if !can_attack && !usable_skills.empty?
          act.set_skill(usable_skills.first.id) if act.respond_to?(:set_skill)
          return act
        end

        # 7. Guard when disarmed without usable skills or items to avoid stalled turns.
        if can_guard && act.respond_to?(:set_guard)
          act.set_guard
        elsif can_attack && act.respond_to?(:set_attack)
          act.set_attack
        end
        act
      end

      def write(op)
        case op['op']
        when 'gold'
          target = Bridge.integer(op['value'], 0, 2_147_483_647)
          $game_party.gain_gold(target - $game_party.gold)
          ['gold:0']
        when 'var', 'sw'
          id = Bridge.integer(op['id'], 1, Bridge.names(op['op']).size - 1)
          if op['op'] == 'var'
            $game_variables[id] = Bridge.integer(op['value'], -2_147_483_648, 2_147_483_647)
          else
            raise 'Expected boolean switch' unless op['value'] == true || op['value'] == false
            $game_switches[id] = op['value']
          end
          ["#{op['op']}:#{id}"]
        when 'count'
          target = Bridge.integer(op['value'], 0, 99_999)
          value = item(op['kind'], op['id'])
          $game_party.gain_item(value, target - $game_party.item_number(value))
          ["#{op['kind']}:#{op['id']}"]
        when 'actor'
          EditActors.apply(op['id'], op['patch'])
          op['patch'].keys.map { |key| "#{key}:#{op['id']}" }
        when 'runFlag'
          set_run_flag(op['key'], op['value'])
          [op['key']]
        when 'moveRate'
          rate = Bridge.number(op['value'], 0.5, 4.0)
          apply_move_rate(rate)
          ['walkRate:0', 'runRate:0']
        when 'walkRate'
          rate = Bridge.number(op['value'], 0.5, 4.0)
          apply_walk_rate(rate)
          ['walkRate:0']
        when 'runRate'
          rate = Bridge.number(op['value'], 0.5, 4.0)
          apply_run_rate(rate)
          ['runRate:0']
        when 'gameSpeed'
          rate = Bridge.number(op['value'], 1.0, 5.0)
          apply_game_speed(rate)
          ['gameSpeed:0']
        when 'runAction'
          handle_run_action(op['id'])
          [op['id']]
        else
          raise "Unsupported RGSS operation: #{op['op']}"
        end
      end

      def apply(op)
        entry = lock_command(op)
        if entry
          key, command = entry
          if op['on']
            enforce(command)
            locks[key] = command
          else
            locks.delete(key)
          end
          return ["lock:#{key}"]
        end
        fields = write(op)
        fields.each do |key|
          next unless locks.key?(key)
          locks[key] = if op['op'] == 'actor'
                         { 'op' => 'actor', 'id' => op['id'], 'patch' => { key.split(':').first => op['patch'][key.split(':').first] } }
                       else
                         op.dup
                       end
        end
        if op['op'] == 'actor'
          { 'skillIds' => 'actorSkill', 'stateIds' => 'actorState' }.each do |field, prefix|
            next unless op['patch'].key?(field)
            locks.each do |key, command|
              next unless key.start_with?("#{prefix}:#{op['id']}:")
              command['owned'] = op['patch'][field].include?(command['entryId'])
            end
          end
        end
        case op['op']
        when 'gold' then ['gold']
        when 'count' then ["count:#{op['kind']}:#{op['id']}"]
        when 'actor' then ["actor:#{op['id']}"]
        when 'runFlag' then ["runFlag:#{op['key']}"]
        when 'moveRate', 'walkRate', 'runRate' then ['moveRate']
        when 'gameSpeed' then ['gameSpeed']
        when 'runAction' then ["runAction:#{op['id']}"]
        else fields
        end
      end
    end
  end
end
