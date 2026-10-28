module ChayaRGSS
  module EditActors
    PARAMS ||= {
      'mhp' => [:mhp, :maxhp], 'mmp' => [:mmp, :maxmp],
      'atk' => [:atk], 'def' => [:def], 'mat' => [:mat, :spi],
      'mdf' => [:mdf, :spi], 'agi' => [:agi], 'luk' => [:luk]
    }.freeze
    class << self
      def actor(id)
        Bridge.integer(id, 1, 9999)
        value = $game_actors && $game_actors[id]
        raise "Actor #{id} is unavailable" unless value
        value
      end

      def parameter(actor, key)
        (PARAMS[key] || [key.to_sym]).find { |name| actor.respond_to?(name) }
      end

      def read(actor, key, fallback = 0)
        name = parameter(actor, key)
        name ? actor.public_send(name) : fallback
      end

      def owned(actor, kind)
        return [] unless actor.respond_to?(kind)
        actor.public_send(kind).map { |entry| entry.is_a?(Numeric) ? entry : entry.id }
      end

      def snapshot
        result = {}
        return result unless $game_actors && $data_actors
        ($data_actors || []).each_with_index do |data, id|
          next unless data && id > 0
          value = $game_actors[id]
          next unless value
          row = {
            'name' => Bridge.t_name(read(value, 'name', "Actor #{id}").to_s),
            'nickname' => Bridge.t_name(read(value, 'nickname', '').to_s),
            'profile' => Bridge.t_name(read(value, 'profile', '').to_s),
            'level' => read(value, 'level', 1), 'exp' => read(value, 'exp'),
            'hp' => read(value, 'hp'), 'mp' => read(value, 'mp'),
            'classId' => read(value, 'class_id', 1),
            'skillIds' => owned(value, :skills), 'stateIds' => owned(value, :states)
          }
          row['exp'] = 0 unless row['exp'].is_a?(Numeric)
          PARAMS.each_key { |key| row[key] = read(value, key, key == 'mhp' ? 1 : 0) }
          result[id] = row
        end
        result
      end

      def write_parameter(actor, key, value)
        target = Bridge.integer(value, key == 'mhp' ? 1 : 0, 2_147_483_647)
        name = parameter(actor, key)
        raise "Actor field #{key} is unsupported by this game" unless name
        if actor.respond_to?(:add_param)
          actor.add_param(PARAMS.keys.index(key), target - read(actor, key))
        elsif actor.respond_to?("#{name}=")
          actor.public_send("#{name}=", target)
        else
          raise "Actor field #{key} cannot be changed in this game"
        end
      end

      def write_owned(actor, kind, values)
        raise "Expected an array for #{kind}" unless values.is_a?(Array)
        next_ids = values.map { |id| Bridge.integer(id, 1, 9999) }.uniq
        before = owned(actor, kind)
        add, remove = kind == :skills ? [:learn_skill, :forget_skill] : [:add_state, :remove_state]
        raise "Actor #{kind} cannot be changed in this game" unless actor.respond_to?(add) && actor.respond_to?(remove)
        (before - next_ids).each { |id| actor.public_send(remove, id) }
        (next_ids - before).each { |id| actor.public_send(add, id) }
      end

      def apply(id, patch)
        value = actor(id)
        raise 'Expected actor patch' unless patch.is_a?(Hash)
        unknown = patch.keys - (PARAMS.keys + %w[name nickname profile level exp hp mp classId skillIds stateIds])
        raise "Unsupported actor fields: #{unknown.join(', ')}" unless unknown.empty?
        patch.each do |key, target|
          if PARAMS.key?(key)
            write_parameter(value, key, target)
          elsif %w[name nickname profile].include?(key)
            raise "Actor field #{key} is unsupported by this game" unless value.respond_to?("#{key}=")
            value.public_send("#{key}=", target.to_s)
          elsif key == 'level'
            raise 'Actor level cannot be changed in this game' unless value.respond_to?(:change_level)
            maximum = value.respond_to?(:max_level) ? value.max_level : 99
            value.change_level(Bridge.integer(target, 1, maximum), false)
          elsif key == 'exp'
            raise 'Actor experience cannot be changed in this game' unless value.respond_to?(:change_exp)
            value.change_exp(Bridge.integer(target, 0, 2_147_483_647), false)
          elsif key == 'classId'
            Bridge.integer(target, 1, ($data_classes || []).size - 1)
            if value.respond_to?(:change_class)
              value.change_class(target)
            elsif value.respond_to?(:class_id=)
              value.class_id = target
            else
              raise 'Actor class cannot be changed in this game'
            end
          elsif key == 'hp' || key == 'mp'
            maximum = read(value, key == 'hp' ? 'mhp' : 'mmp')
            raise 'Expected non-negative integer' unless target.is_a?(Integer) && target >= 0
            value.public_send("#{key}=", [target, maximum].min)
          else
            write_owned(value, key == 'skillIds' ? :skills : :states, target)
          end
        end
      end
    end
  end
end
