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
          'autoWin' => auto_win?
        }
        SYSTEM_FLAGS.each { |key, name| result[key] = !($game_system && $game_system.public_send(name)) }
        result
      end

      def click_move?
        @click_move != false
      end

      def always_dash?
        @always_dash == true
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
          tick_auto_battle if value
        elsif key == 'autoWin'
          @auto_win = value
          tick_auto_win if value
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
        locks.each do |key, command|
          begin
            enforce(command)
          rescue StandardError => error
            locks.delete(key)
            Bridge.log("Released lock #{key}: #{error.message}", 'warn')
          end
        end
      end

      def ensure_hooks
        return if @hooks_installed
        install_dash_hook if defined?(Game_Player) || (defined?($game_player) && $game_player)
        install_message_hook if defined?(Window_Message)
        install_battle_hooks if defined?(Game_Actor) || (defined?($game_actors) && $game_actors) || defined?(BattleManager)
        @hooks_installed = true if defined?(Game_Player) && defined?(Window_Message) && defined?(BattleManager)
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
      end

      def install_battle_hooks
        actor_class = if defined?(Game_Actor)
                        Game_Actor
                      elsif defined?($game_actors) && $game_actors && $game_actors[1]
                        $game_actors[1].class
                      end
        if actor_class && actor_class.method_defined?(:auto_battle?) && !actor_class.method_defined?(:chaya_orig_auto_battle?)
          actor_class.class_eval do
            alias_method :chaya_orig_auto_battle?, :auto_battle?
            def auto_battle?
              return true if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.auto_battle?
              chaya_orig_auto_battle?
            end
          end
        end
        if defined?(BattleManager)
          bm_meta = class << BattleManager; self; end
          if BattleManager.respond_to?(:judge_win_loss) && !bm_meta.method_defined?(:chaya_orig_judge_win_loss)
            bm_meta.class_eval do
              alias_method :chaya_orig_judge_win_loss, :judge_win_loss
              def judge_win_loss
                if defined?(ChayaRGSS::EditRuntime) && ChayaRGSS::EditRuntime.auto_win?
                  if @phase && @phase != :battle_end && defined?($game_troop) && $game_troop && !$game_troop.members.empty?
                    return ChayaRGSS::EditRuntime.finish_auto_win
                  end
                end
                chaya_orig_judge_win_loss
              end
            end
          end
        end
      end

      def finish_auto_win
        return false if @resolving_auto_win
        begin
          @resolving_auto_win = true
          $game_troop.members.each { |enemy| enemy.hp = 0 if enemy.respond_to?(:hp=) }
          BattleManager.process_victory
        ensure
          @resolving_auto_win = false
        end
      end

      def tick_auto_win
        return if @resolving_auto_win
        return unless auto_win?
        return unless defined?(BattleManager) && defined?(SceneManager) && defined?(Scene_Battle)
        scene = SceneManager.scene rescue nil
        return unless scene.is_a?(Scene_Battle)
        return if defined?($game_troop) && $game_troop.respond_to?(:interpreter) && $game_troop.interpreter && $game_troop.interpreter.respond_to?(:running?) && $game_troop.interpreter.running?
        phase = BattleManager.instance_variable_get(:@phase) rescue nil
        if phase && phase != :battle_end
          if defined?($game_troop) && $game_troop && !$game_troop.members.empty?
            finish_auto_win
          end
        end
      end

      def tick_auto_battle
        return unless auto_battle? && !auto_win?
        return unless defined?(BattleManager) && defined?(SceneManager) && defined?(Scene_Battle)
        scene = SceneManager.scene rescue nil
        return unless scene.is_a?(Scene_Battle)
        return if defined?($game_troop) && $game_troop.respond_to?(:interpreter) && $game_troop.interpreter && $game_troop.interpreter.respond_to?(:running?) && $game_troop.interpreter.running?
        phase = BattleManager.instance_variable_get(:@phase) rescue nil
        if phase == :input
          if defined?($game_party) && $game_party.respond_to?(:battle_members)
            $game_party.battle_members.each do |actor|
              actor.make_auto_battle_actions if actor.respond_to?(:make_auto_battle_actions)
            end
          end
          [:@party_command_window, :@actor_command_window].each do |var|
            win = scene.instance_variable_get(var) rescue nil
            win.deactivate if win && win.respond_to?(:deactivate)
          end
          BattleManager.start_turn if BattleManager.respond_to?(:start_turn)
        end
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
          target = Bridge.integer(op['value'], 0, 999)
          value = item(op['kind'], op['id'])
          $game_party.gain_item(value, target - $game_party.item_number(value))
          ["#{op['kind']}:#{op['id']}"]
        when 'actor'
          EditActors.apply(op['id'], op['patch'])
          op['patch'].keys.map { |key| "#{key}:#{op['id']}" }
        when 'runFlag'
          set_run_flag(op['key'], op['value'])
          [op['key']]
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
        else fields
        end
      end
    end
  end
end
