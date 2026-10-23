# Windows RGSS DLL memory patchers must never run against mkxp-z's native memory.
# Replace this identifiable resolution hack in memory: mkxp-z already supports
# arbitrary framebuffer sizes. The packed Scripts archive is not written back.
$RGSS_SCRIPTS.each do |entry|
  source = entry[3]
  next unless source.is_a?(String)
  if source.include?('module WFRGSS') && source.include?('def self.fatalerror( errobj )')
    # The old handler calls Graphics.update before game state exists and can
    # replace the real exception with a second error. Preserve the first cause.
    source.sub!('def self.fatalerror( errobj )', "def self.fatalerror( errobj )\n    raise errobj\n")
  end
  if source.include?('module InputMouse') && source.include?('def self.press?(sym)')
    source.sub!('def self.press?(sym)', "def self.press?(sym)\n    val = @@input_table[sym]\n    return true if val\n    return false if val == false\n    respond_to?(:__Mouse__press?) ? __Mouse__press?(sym) : false")
    source.sub!('def self.trigger?(sym)', "def self.trigger?(sym)\n    val = @@input_table[sym]\n    return true if val == 0\n    return false if val\n    respond_to?(:__Mouse__trigger?) ? __Mouse__trigger?(sym) : false")
    if source.include?('def self.update_input_table_c_move')
      source.sub!('def self.update_input_table_c_move', "def self.update_input_table_c_move\n    return")
    end
    System.puts("[Chaya RGSS] Patched UniversalMouse input interception and map movement: #{entry[1]}") if defined?(System) && System.respond_to?(:puts)
  end
  if source.include?('module FileSystem') && source =~ /ANALYSIS_BITMAPS\s*=\s*true/
    source.sub!(/ANALYSIS_BITMAPS\s*=\s*true/, 'ANALYSIS_BITMAPS = false')
    System.puts("[Chaya RGSS] Disabled FileSystem::ANALYSIS_BITMAPS to prevent Sprite recursion crash: #{entry[1]}") if defined?(System) && System.respond_to?(:puts)
  end
  if source.include?('@public_rect != self.bitmap.rect')
    source.sub!('@public_rect != self.bitmap.rect', '(@public_rect.nil? || self.bitmap.nil? || self.bitmap.disposed? || @public_rect.x != self.bitmap.rect.x || @public_rect.y != self.bitmap.rect.y || @public_rect.width != self.bitmap.rect.width || @public_rect.height != self.bitmap.rect.height)')
    System.puts("[Chaya RGSS] Patched Sprite#update_internal Rect comparison: #{entry[1]}") if defined?(System) && System.respond_to?(:puts)
  end
  next unless source.include?("DL.dlopen('user32')") && source.include?('@@DLLHandle') && source.include?('Graphics::PlaneSpeedUp')
  size = source.match(/SCREEN_SIZE\s*=\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/)
  next unless size
  width, height = size[1].to_i, size[2].to_i
  raise "Chaya RGSS: invalid framebuffer size #{width}x#{height}" unless (1..8192).include?(width) && (1..8192).include?(height)
  entry[3] = <<~RUBY
    module Graphics
      SCREEN_SIZE = [#{width}, #{height}]
      PlaneSpeedUp = false
      def self.monitor_width; Graphics.display_width; end
      def self.monitor_height; Graphics.display_height; end
    end
    class Game_Event < Game_Character
      def near_the_screen?(dx = nil, dy = nil)
        dx ||= Graphics.width / 64 + 5
        dy ||= Graphics.height / 64 + 5
        ax = $game_map.adjust_x(@real_x) - Graphics.width / 2 / 32
        ay = $game_map.adjust_y(@real_y) - Graphics.height / 2 / 32
        ax >= -dx && ax <= dx && ay >= -dy && ay <= dy
      end
    end
    Graphics.resize_screen(*Graphics::SCREEN_SIZE)
  RUBY
  System.puts("[Chaya RGSS] Replaced Windows resolution memory patch: #{entry[1]}") if defined?(System) && System.respond_to?(:puts)
end
