# Native RGSS Bridge for Chaya (WebSocket transport)
require 'json'
require 'thread'
require_relative 'ws_client'

module ChayaRGSS
  module Bridge
    LIMIT = 64
    class << self
      def log(message, level = 'info')
        @logs << { 'source' => 'ChayaRGSS', 'level' => level, 'message' => message.to_s[0, 500] } if @logs && @logs.size < LIMIT
      end

      def integer(value, min, max)
        raise 'Expected bounded integer' unless value.is_a?(Integer) && value >= min && value <= max
        value
      end

      def names(kind)
        raise 'Game database is not ready' unless $data_system
        kind == 'var' ? $data_system.variables : $data_system.switches
      end

      def full_session_state
        ready = !!($data_system && $game_party && $game_variables && $game_switches)
        return { 'ready' => false } unless ready

        vars = {}
        (1...names('var').size).each do |id|
          val = $game_variables[id]
          vars[id] = val if val.is_a?(Numeric) && val.finite?
        end

        switches = {}
        (1...names('sw').size).each do |id|
          val = $game_switches[id]
          switches[id] = !!val
        end

        counts = {}
        if $game_party.respond_to?(:all_items)
          $game_party.all_items.each do |item|
            next unless item
            kind = item.is_a?(RPG::Item) ? 'item' : item.is_a?(RPG::Weapon) ? 'weapon' : 'armor'
            counts["#{kind}:#{item.id}"] = $game_party.item_number(item)
          end
        end

        session = {
          'gold' => $game_party.gold,
          'counts' => counts,
          'vars' => vars,
          'switches' => switches,
          'locks' => {},
          'actors' => {},
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
        }

        { 'type' => 'edit.state', 'ready' => true, 'session' => session }
      end

      def apply(op)
        case op['op']
        when 'gold'
          target = integer(op['value'], 0, 2_147_483_647)
          $game_party.gain_gold(target - $game_party.gold)
          ['gold']
        when 'var'
          id = integer(op['id'], 1, names('var').size - 1)
          $game_variables[id] = integer(op['value'], -2_147_483_648, 2_147_483_647)
          ["var:#{id}"]
        when 'sw'
          id = integer(op['id'], 1, names('sw').size - 1)
          $game_switches[id] = !!op['value']
          ["sw:#{id}"]
        when 'count'
          id = integer(op['id'], 1, 9999)
          val = integer(op['value'], 0, 999)
          item = case op['kind']
                 when 'item' then $data_items[id]
                 when 'weapon' then $data_weapons[id]
                 when 'armor' then $data_armors[id]
                 end
          if item
            diff = val - $game_party.item_number(item)
            $game_party.gain_item(item, diff)
          end
          ["count:#{op['kind']}:#{id}"]
        else
          []
        end
      end

      def pump
        return unless @commands
        4.times do
          cmd = @commands.pop(true) rescue nil
          break unless cmd
          begin
            if cmd['type'] == 'edit.cmd'
              fields = apply(cmd)
              @replies << { 'type' => 'edit.ack', 'cmdId' => cmd['cmdId'], 'ok' => true, 'fields' => fields }
            end
          rescue StandardError => err
            @replies << { 'type' => 'edit.ack', 'cmdId' => cmd['cmdId'], 'ok' => false, 'error' => err.message[0, 200], 'fields' => [] }
          end
        end
      end

      def start
        return if @worker && @worker.alive?
        @room = ENV.fetch('CHAYA_RGSS_ROOM', 'default')
        @commands = Queue.new
        @replies = Queue.new
        @logs = Queue.new

        @worker = Thread.new do
          loop do
            begin
              ws = WSClient.connect('127.0.0.1', 3928, "/?role=game&roomId=#{@room}")
              unless ws
                sleep 2
                next
              end

              # Send hello
              WSClient.send_text(ws, JSON.generate({ 'type' => 'hello', 'role' => 'game', 'gameId' => @room }))

              last_state = Time.now.to_f
              loop do
                # 1. Drain replies to send
                while reply = (@replies.pop(true) rescue nil)
                  WSClient.send_text(ws, JSON.generate(reply))
                end

                # 2. Push state every 1s
                now = Time.now.to_f
                if now - last_state >= 1.0
                  state = full_session_state
                  WSClient.send_text(ws, JSON.generate(state)) if state['ready']
                  last_state = now
                end

                # 3. Read incoming command non-blocking via select
                ready = IO.select([ws], nil, nil, 0.1)
                if ready
                  text = WSClient.read_text(ws)
                  break if text.nil? # closed
                  next if text.empty?
                  begin
                    msg = JSON.parse(text)
                    @commands << msg if msg.is_a?(Hash)
                  rescue StandardError
                  end
                end
              end
            rescue StandardError
              sleep 1
            ensure
              ws.close rescue nil if ws
            end
          end
        end
      end
    end
  end
end

class << Graphics
  unless method_defined?(:chaya_bridge_update)
    alias_method :chaya_bridge_update, :update
    def update(*args)
      ChayaRGSS::Bridge.pump
      chaya_bridge_update(*args)
    end
  end
end

ChayaRGSS::Bridge.start

