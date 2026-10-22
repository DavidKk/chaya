# RGSS Mouse Movement (Click-to-Move) for Chaya
# Allows player movement using mouse clicks in Scene_Map.
# Keyboard input interrupts active mouse pathfinding.

module ChayaRGSS
  module MouseMovement
    TILE_SIZE = 32

    class << self
      attr_accessor :target_x, :target_y, :path, :active

      def reset
        @target_x = nil
        @target_y = nil
        @path = nil
        @active = false
      end

      def interrupt
        reset
      end

      def on_map?
        defined?($game_map) && $game_map && defined?($game_player) && $game_player
      end

      # Converts screen mouse coordinates into map tile coordinates
      def screen_to_map(screen_x, screen_y)
        return nil unless on_map?
        tile_x = ($game_map.display_x + screen_x.to_f / TILE_SIZE).floor
        tile_y = ($game_map.display_y + screen_y.to_f / TILE_SIZE).floor
        tile_x %= $game_map.width if $game_map.respond_to?(:loop_horizontal?) && $game_map.loop_horizontal?
        tile_y %= $game_map.height if $game_map.respond_to?(:loop_vertical?) && $game_map.loop_vertical?
        [tile_x, tile_y]
      end

      # BFS / Greedy direction towards destination
      def next_direction(start_x, start_y, dest_x, dest_y)
        return 0 if start_x == dest_x && start_y == dest_y
        
        # Directions: 2: Down, 4: Left, 6: Right, 8: Up
        dx = dest_x - start_x
        dy = dest_y - start_y

        candidates = []
        if dy.abs > dx.abs
          candidates << (dy > 0 ? 2 : 8)
          candidates << (dx > 0 ? 6 : 4) if dx != 0
          candidates << (dx > 0 ? 4 : 6) if dx != 0
          candidates << (dy > 0 ? 8 : 2)
        else
          candidates << (dx > 0 ? 6 : 4)
          candidates << (dy > 0 ? 2 : 8) if dy != 0
          candidates << (dy > 0 ? 8 : 2) if dy != 0
          candidates << (dx > 0 ? 4 : 6)
        end

        candidates.find do |dir|
          $game_player.passable?(start_x, start_y, dir) rescue true
        end || candidates.first || 0
      end

      def update
        return unless on_map?
        return unless defined?(Input)

        # 1. Keyboard interrupts mouse path
        keyboard_interrupted = false
        if defined?(Input::UP) && (Input.press?(Input::UP) || Input.press?(Input::DOWN) || Input.press?(Input::LEFT) || Input.press?(Input::RIGHT))
          keyboard_interrupted = true
        end

        if keyboard_interrupted
          interrupt
          return
        end

        # 2. Check mouse click trigger
        if defined?(Input::MOUSELEFT) && Input.trigger?(Input::MOUSELEFT)
          if Input.respond_to?(:mouse_x) && Input.respond_to?(:mouse_y)
            coords = screen_to_map(Input.mouse_x, Input.mouse_y)
            if coords
              @target_x, @target_y = coords
              @active = true
            end
          end
        end

        # 3. Follow path if active and player can move
        if @active && @target_x && @target_y
          if $game_player.x == @target_x && $game_player.y == @target_y
            reset
            return
          end

          unless $game_player.moving?
            dir = next_direction($game_player.x, $game_player.y, @target_x, @target_y)
            if dir > 0
              $game_player.move_straight(dir)
              # If after moving straight player did not move or can't step, check if stuck
              if !$game_player.moving? && !($game_player.passable?($game_player.x, $game_player.y, dir) rescue false)
                reset
              end
            else
              reset
            end
          end
        end
      end
    end
  end
end

ChayaRGSS::MouseMovement.reset

