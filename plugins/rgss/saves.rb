require 'json'
require 'fileutils'

module ChayaRGSS
  module Saves
    DEFAULTS = { 'version' => 1, 'revision' => 0, 'enabled' => false, 'intervalMin' => 5, 'maxCount' => 30, 'quickEnabled' => false, 'autoStorage' => 'game', 'quickStorage' => 'game' }.freeze
    class << self
      def root
        File.join(ENV.fetch('CHAYA_RGSS_SESSION'), 'saves')
      end

      def settings
        @settings ||= read_json('settings.json', DEFAULTS.dup)
      end

      def index
        @index ||= read_json('index.json', { 'version' => 1, 'revision' => 0, 'entries' => [] })
      end

      def read_json(name, fallback)
        file = File.join(root, name)
        File.file?(file) ? JSON.parse(File.read(file)) : fallback
      end

      def write_json(name, data)
        atomic_write(File.join(root, name), JSON.generate(data))
      end

      def atomic_write(file, contents)
        FileUtils.mkdir_p(root)
        File.open(file + '.tmp', 'wb') { |io| io.write(contents) }
        File.rename(file + '.tmp', file)
      end

      def unsafe_reason
        return 'notMap' unless $game_party && $game_map && $game_player
        return 'battle' if $game_party.respond_to?(:in_battle) && $game_party.in_battle
        return 'message' if $game_message && $game_message.respond_to?(:busy?) && $game_message.busy?
        return 'event' if $game_map.respond_to?(:interpreter) && $game_map.interpreter.running?
        return 'moving' if $game_player.respond_to?(:moving?) && $game_player.moving?
        nil
      end

      def snapshot
        { 'settings' => settings, 'index' => index, 'versionId' => version_id,
          'status' => { 'enabled' => settings['enabled'], 'nextDueInMs' => nil, 'counting' => false, 'waiting' => unsafe_reason, 'busy' => nil, 'offline' => [] } }
      end

      def version_id
        $data_system && $data_system.respond_to?(:version_id) ? $data_system.version_id : 0
      end

      def file_for(id)
        raise 'Invalid save id' unless id.is_a?(String) && id.match(/\A(?:quick-[0-9]|auto-[0-9a-z]{6,40})\z/)
        File.join(root, id + '.marshal')
      end

      def contents
        return DataManager.make_save_contents if defined?(DataManager) && DataManager.respond_to?(:make_save_contents)
        { :system => $game_system, :message => $game_message, :switches => $game_switches,
          :variables => $game_variables, :self_switches => $game_self_switches, :actors => $game_actors,
          :party => $game_party, :troop => $game_troop, :map => $game_map, :player => $game_player }
      end

      def restore(data)
        if defined?(DataManager) && DataManager.respond_to?(:extract_save_contents)
          DataManager.extract_save_contents(data)
        else
          $game_system, $game_message = data[:system], data[:message]
          $game_switches, $game_variables, $game_self_switches = data[:switches], data[:variables], data[:self_switches]
          $game_actors, $game_party, $game_troop = data[:actors], data[:party], data[:troop]
          $game_map, $game_player = data[:map], data[:player]
        end
        $game_system.on_after_load if $game_system.respond_to?(:on_after_load)
        if defined?(SceneManager) && defined?(Scene_Map)
          SceneManager.goto(Scene_Map)
        elsif defined?(Scene_Map)
          $scene = Scene_Map.new
        end
      end

      def configure(cmd)
        raise 'Settings revision conflict' unless cmd['expectedRevision'] == settings['revision']
        value = cmd['settings']
        raise 'Invalid settings' unless value.is_a?(Hash) && value['revision'].is_a?(Integer) && value['revision'] > settings['revision']
        # App storage is a separate backend; never silently write to the game instead.
        raise 'RGSS app save storage is not available' unless value['autoStorage'] == 'game' && value['quickStorage'] == 'game'
        raise 'Invalid auto save interval' unless value['intervalMin'].is_a?(Integer) && (1..60).include?(value['intervalMin'])
        raise 'Invalid save retention' unless value['maxCount'].is_a?(Integer) && (15..120).include?(value['maxCount'])
        @settings = DEFAULTS.merge(value)
        write_json('settings.json', settings)
      end

      def save(cmd)
        reason = unsafe_reason
        raise "Unsafe save: #{reason}" if reason && !cmd['force']
        list = cmd['target']
        raise 'Invalid save list' unless ['auto', 'quick'].include?(list)
        raise 'Quick save is disabled' if list == 'quick' && !settings['quickEnabled']
        slot = cmd['slot']
        raise 'Invalid quick save slot' if list == 'quick' && (!slot.is_a?(Integer) || !(0..9).include?(slot))
        now = (Time.now.to_f * 1000).to_i
        id = list == 'quick' ? "quick-#{slot}" : "auto-#{now.to_s(36)}"
        data = Marshal.dump(contents)
        atomic_write(file_for(id), data)
        entry = { 'id' => id, 'list' => list, 'slot' => slot, 'tag' => list == 'quick' ? 'quick' : 'manual',
          'unsafe' => !!reason, 'savedAt' => now, 'playtimeFrames' => Graphics.frame_count,
          'mapId' => $game_map.map_id, 'mapName' => '', 'partyNames' => $game_party.members.map { |actor| actor.name },
          'versionId' => version_id, 'engine' => defined?(DataManager) ? 'vx-ace' : 'vx', 'bytes' => data.bytesize, 'hasThumb' => false }
        index['entries'].reject! { |existing| existing['id'] == id }
        index['entries'] << entry
        if list == 'auto'
          index['entries'].select { |item| item['list'] == 'auto' }.sort_by { |item| -item['savedAt'] }.drop(settings['maxCount']).each { |item| remove(item['id']) }
        end
        commit_index
      end

      def remove(id)
        file = file_for(id)
        index['entries'].reject! { |entry| entry['id'] == id }
        File.delete(file) if File.file?(file)
      end

      def commit_index
        index['revision'] += 1
        write_json('index.json', index)
      end

      def handle(cmd)
        reply = { 'type' => 'saves.reply', 'reqId' => cmd['reqId'], 'gameId' => ENV.fetch('CHAYA_RGSS_ROOM') }
        begin
          case cmd['op']
          when 'snapshot' then nil
          when 'configure' then configure(cmd)
          when 'save' then save(cmd)
          when 'load'
            raise 'Cannot load during an event or battle' if unsafe_reason
            entry = index['entries'].find { |item| item['id'] == cmd['entryId'] }
            raise 'Save not found' unless entry
            raise 'Save belongs to another game version' if entry['versionId'] != version_id && !cmd['allowVersionMismatch']
            restore(Marshal.load(File.binread(file_for(entry['id']))))
          when 'delete'
            remove(cmd['entryId']); commit_index
          when 'clear'
            raise 'Invalid save list' unless ['auto', 'quick'].include?(cmd['list'])
            index['entries'].select { |item| item['list'] == cmd['list'] }.each { |item| remove(item['id']) }
            commit_index
          when 'thumb' then nil
          else raise 'Unsupported save operation'
          end
          reply.merge('ok' => true, 'snapshot' => snapshot)
        rescue StandardError => error
          reply.merge('ok' => false, 'error' => error.message, 'code' => 'failed')
        end
      end
    end
  end
end
