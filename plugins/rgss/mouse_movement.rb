# RGSS Mouse Movement & Destination Indicator for Chaya
# Allows player movement using mouse clicks in Scene_Map with A* pathfinding.
# Displays an animated destination sprite on the map (matching RPG Maker MV / MZ Sprite_Destination).
# Keyboard input interrupts active mouse pathfinding.

module ChayaRGSS
  module MouseMovement
    TILE_SIZE ||= 32
    MAX_PATH_CELLS ||= 65536
    DIRECTIONS ||= [2, 4, 6, 8].freeze

    # MinHeap priority queue for A*
    class MinHeap
      def initialize
        @elements = []
      end

      def empty?
        @elements.empty?
      end

      def push(node, f, h)
        @elements << [node, f, h]
        bubble_up(@elements.size - 1)
      end

      def pop
        return nil if @elements.empty?
        top = @elements[0][0]
        last = @elements.pop
        if !@elements.empty?
          @elements[0] = last
          bubble_down(0)
        end
        top
      end

      private

      def less(i, j)
        ei = @elements[i]
        ej = @elements[j]
        ei[1] < ej[1] || (ei[1] == ej[1] && ei[2] < ej[2])
      end

      def bubble_up(i)
        while i > 0
          parent = (i - 1) >> 1
          break unless less(i, parent)
          @elements[i], @elements[parent] = @elements[parent], @elements[i]
          i = parent
        end
      end

      def bubble_down(i)
        last = @elements.size
        loop do
          left = i * 2 + 1
          right = left + 1
          smallest = i
          smallest = left if left < last && less(left, smallest)
          smallest = right if right < last && less(right, smallest)
          break if smallest == i
          @elements[i], @elements[smallest] = @elements[smallest], @elements[i]
          i = smallest
        end
      end
    end

    class << self
      attr_accessor :target_x, :target_y, :path, :active, :dest_sprite, :frame_count

      def reset
        @target_x = nil
        @target_y = nil
        @path = nil
        @active = false
        @frame_count = 0
        if @dest_sprite && !@dest_sprite.disposed?
          @dest_sprite.visible = false
        end
      end

      def interrupt
        reset
      end

      def on_map?
        defined?($game_map) && $game_map && defined?($game_player) && $game_player
      end

      def axis_distance(a, b, size, loop_axis)
        d = (a - b).abs
        loop_axis ? [d, size - d].min : d
      end

      def step_x(x, d, width, loop_x)
        nx = x + (d == 6 ? 1 : d == 4 ? -1 : 0)
        loop_x ? (nx + width) % width : nx
      end

      def step_y(y, d, height, loop_y)
        ny = y + (d == 2 ? 1 : d == 8 ? -1 : 0)
        loop_y ? (ny + height) % height : ny
      end

      # A* pathfinding algorithm matching MV pathfinding.ts
      def find_path(start_x, start_y, goal_x, goal_y, max_expand = 800)
        return [] if start_x == goal_x && start_y == goal_y
        return nil unless on_map?

        width = $game_map.width
        height = $game_map.height
        cells = width * height
        return nil if cells <= 0 || cells > MAX_PATH_CELLS
        return nil if start_x < 0 || start_y < 0 || start_x >= width || start_y >= height

        loop_x = $game_map.respond_to?(:loop_horizontal?) && $game_map.loop_horizontal?
        loop_y = $game_map.respond_to?(:loop_vertical?) && $game_map.loop_vertical?

        index = ->(x, y) { y * width + x }
        heuristic = ->(x, y) {
          axis_distance(x, goal_x, width, loop_x) + axis_distance(y, goal_y, height, loop_y)
        }

        goal_in_bounds = goal_x >= 0 && goal_y >= 0 && goal_x < width && goal_y < height
        goal_index = goal_in_bounds ? index.call(goal_x, goal_y) : -1

        start_index = index.call(start_x, start_y)
        start_h = heuristic.call(start_x, start_y)

        g = {}
        parent = {}
        via = {}
        closed = {}

        g[start_index] = 0
        best = start_index
        best_h = start_h

        open = MinHeap.new
        open.push(start_index, start_h, start_h)

        expanded = 0
        while !open.empty? && expanded < max_expand
          current = open.pop
          next if closed[current]
          closed[current] = true
          expanded += 1

          if current == goal_index
            best = current
            best_h = 0
            break
          end

          cx = current % width
          cy = current / width
          ch = heuristic.call(cx, cy)
          if ch < best_h || (ch == best_h && (g[current] || 0) < (g[best] || 0))
            best = current
            best_h = ch
          end

          DIRECTIONS.each do |d|
            nx = step_x(cx, d, width, loop_x)
            ny = step_y(cy, d, height, loop_y)
            next if nx < 0 || ny < 0 || nx >= width || ny >= height

            next_idx = index.call(nx, ny)
            next if closed[next_idx]

            # Passability check from (cx, cy) in direction d
            passable = $game_player.passable?(cx, cy, d) rescue false
            next unless passable

            ng = (g[current] || 0) + 1
            if g[next_idx] && ng >= g[next_idx]
              next
            end

            g[next_idx] = ng
            parent[next_idx] = current
            via[next_idx] = d
            nh = heuristic.call(nx, ny)
            open.push(next_idx, ng + nh, nh)
          end
        end

        steps = []
        node = best
        while node != start_index && parent[node]
          steps << via[node]
          node = parent[node]
        end
        steps.reverse
      end

      # Converts screen mouse coordinates into map tile coordinates
      def screen_to_map(screen_x, screen_y)
        return nil unless on_map?
        disp_x = $game_map.display_x
        disp_y = $game_map.display_y
        if disp_x.is_a?(Numeric) && disp_x > $game_map.width
          disp_x = disp_x / 256.0
          disp_y = disp_y / 256.0
        end
        tile_x = (disp_x + screen_x.to_f / TILE_SIZE).floor
        tile_y = (disp_y + screen_y.to_f / TILE_SIZE).floor
        tile_x %= $game_map.width if $game_map.respond_to?(:loop_horizontal?) && $game_map.loop_horizontal?
        tile_y %= $game_map.height if $game_map.respond_to?(:loop_vertical?) && $game_map.loop_vertical?
        [tile_x, tile_y]
      end

      # Update destination sprite position and animation
      def update_destination_sprite
        return unless on_map?
        return unless defined?(Sprite) && defined?(Bitmap) && defined?(Color)

        show_sprite = @active && @target_x && @target_y && ($game_player.x != @target_x || $game_player.y != @target_y)

        if show_sprite
          unless @dest_sprite && !@dest_sprite.disposed?
            @dest_sprite = Sprite.new rescue nil
            if @dest_sprite
              bmp = Bitmap.new(TILE_SIZE, TILE_SIZE) rescue nil
              if bmp
                bmp.fill_rect(0, 0, TILE_SIZE, TILE_SIZE, Color.new(255, 255, 255)) rescue nil
                @dest_sprite.bitmap = bmp
              end
              @dest_sprite.ox = TILE_SIZE / 2 rescue 16
              @dest_sprite.oy = TILE_SIZE / 2 rescue 16
              @dest_sprite.z = 200 rescue nil
              @dest_sprite.blend_type = 1 if @dest_sprite.respond_to?(:blend_type=) rescue nil # BLEND_ADD
            end
          end

          if @dest_sprite && !@dest_sprite.disposed?
            # Follow map coordinate using adjust_x / adjust_y so it scrolls with the map
            disp_x = $game_map.display_x
            disp_y = $game_map.display_y
            if disp_x.is_a?(Numeric) && disp_x > $game_map.width
              disp_x = disp_x / 256.0
              disp_y = disp_y / 256.0
            end
            adj_x = $game_map.respond_to?(:adjust_x) ? $game_map.adjust_x(@target_x) : (@target_x - disp_x)
            adj_y = $game_map.respond_to?(:adjust_y) ? $game_map.adjust_y(@target_y) : (@target_y - disp_y)
            @dest_sprite.x = (adj_x + 0.5) * TILE_SIZE
            @dest_sprite.y = (adj_y + 0.5) * TILE_SIZE

            # 20-frame pulse and expand animation (identical to MV / MZ Sprite_Destination)
            @frame_count = ((@frame_count || 0) + 1) % 20
            @dest_sprite.opacity = (20 - @frame_count) * 6
            scale = 1.0 + @frame_count / 20.0
            @dest_sprite.zoom_x = scale if @dest_sprite.respond_to?(:zoom_x=)
            @dest_sprite.zoom_y = scale if @dest_sprite.respond_to?(:zoom_y=)
            @dest_sprite.visible = true
          end
        else
          if @dest_sprite && !@dest_sprite.disposed?
            @dest_sprite.visible = false
            @frame_count = 0
          end
        end
      end

      def update
        return unless on_map?
        return unless defined?(Input)
        if defined?(ChayaRGSS::EditRuntime) && !ChayaRGSS::EditRuntime.click_move?
          reset
          update_destination_sprite
          return
        end

        # Do not process movement during dialogs, cutscenes, or inactive map scenes
        if defined?($game_message) && $game_message && $game_message.busy?
          reset
          update_destination_sprite
          return
        end
        if $game_map.respond_to?(:interpreter) && $game_map.interpreter && $game_map.interpreter.running?
          reset
          update_destination_sprite
          return
        end
        if defined?(SceneManager) && SceneManager.respond_to?(:scene_is?) && defined?(Scene_Map) && !SceneManager.scene_is?(Scene_Map)
          reset
          update_destination_sprite
          return
        end
        if defined?(ChayaRGSS) && ChayaRGSS.respond_to?(:pointer_blocked?) && ChayaRGSS.pointer_blocked?
          reset
          update_destination_sprite
          return
        end

        raw_press = Input.respond_to?(:chaya_raw_press?) ? :chaya_raw_press? : :press?
        raw_trigger = Input.respond_to?(:chaya_raw_trigger?) ? :chaya_raw_trigger? : :trigger?

        # 1. Keyboard interrupts mouse path
        keyboard_interrupted = false
        if defined?(Input::UP) && (Input.public_send(raw_press, Input::UP) ||
                                   Input.public_send(raw_press, Input::DOWN) ||
                                   Input.public_send(raw_press, Input::LEFT) ||
                                   Input.public_send(raw_press, Input::RIGHT))
          keyboard_interrupted = true
        end

        if keyboard_interrupted
          interrupt
          return
        end

        # 2. Check mouse click trigger with edge detection
        mouse_pressed = defined?(Input::MOUSELEFT) && Input.public_send(raw_press, Input::MOUSELEFT)
        mouse_clicked = (defined?(Input::MOUSELEFT) && Input.public_send(raw_trigger, Input::MOUSELEFT)) ||
                        (mouse_pressed && !@last_mouse_down)
        @last_mouse_down = mouse_pressed

        if mouse_pressed
          @touch_count = (@touch_count || 0) + 1
        else
          @touch_count = 0
        end

        should_sample = mouse_clicked || (@touch_count && @touch_count >= 12)

        if should_sample
          if $game_player.respond_to?(:movable?) && !$game_player.movable?
            # Player is currently immobilized
          elsif Input.respond_to?(:mouse_x) && Input.respond_to?(:mouse_y)
            coords = screen_to_map(Input.mouse_x, Input.mouse_y)
            if coords
              tx, ty = coords
              # Recalculate path if target tile changed, or if previous path ran out
              if tx != @target_x || ty != @target_y || !@active || @path.nil? || @path.empty?
                @target_x = tx
                @target_y = ty
                @active = true
                @path = find_path($game_player.x, $game_player.y, tx, ty)
              end
            end
          end
        end

        # 3. Follow path if active and player can move
        if @active && @target_x && @target_y
          if $game_player.x == @target_x && $game_player.y == @target_y
            reset unless mouse_pressed
            update_destination_sprite rescue nil
            return
          end

          unless $game_player.moving?
            # Recompute path if empty or deviated
            if @path.nil? || @path.empty?
              @path = find_path($game_player.x, $game_player.y, @target_x, @target_y)
            end

            if @path && !@path.empty?
              dir = @path.shift
              $game_player.move_straight(dir)
              if !$game_player.moving? && !($game_player.passable?($game_player.x, $game_player.y, dir) rescue false)
                reset unless mouse_pressed
              end
            else
              # Reached target or nearest passable tile; trigger adjacent event if applicable
              dx = @target_x - $game_player.x
              dy = @target_y - $game_player.y
              if (dx.abs + dy.abs) == 1
                dir = if dx == 1 then 6 elsif dx == -1 then 4 elsif dy == 1 then 2 elsif dy == -1 then 8 else nil end
                $game_player.set_direction(dir) if dir && $game_player.respond_to?(:set_direction)
                $game_player.check_event_trigger_there([0, 1, 2]) if $game_player.respond_to?(:check_event_trigger_there)
              end
              reset unless mouse_pressed
            end
          end
        end

        # 4. Update destination sprite animation
        update_destination_sprite rescue nil
      end
    end
  end
end

ChayaRGSS::MouseMovement.reset

