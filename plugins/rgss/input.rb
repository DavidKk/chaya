# Keep polled RGSS input isolated as well as native WebView events.
module ChayaRGSS
  class << self
    attr_writer :overlay_active, :pointer_active

    def overlay_active?
      !!@overlay_active
    end

    def pointer_active?
      !!@pointer_active
    end

    def pointer_blocked?
      overlay_active? || pointer_active?
    end

    def mouse_button?(key)
      %w[MOUSELEFT MOUSERIGHT MOUSEMIDDLE MOUSEX1 MOUSEX2].any? do |name|
        key.to_s == name || (Input.const_defined?(name) && key == Input.const_get(name))
      end
    end

    def remote_keys_down
      @remote_keys_down ||= {}
    end

    def remote_keys_prev
      @remote_keys_prev ||= {}
    end

    def remote_mouse
      @remote_mouse ||= { :x => -1, :y => -1, :down => false }
    end

    def tick_remote_input
      @remote_keys_prev = (@remote_keys_down || {}).dup
    end

    def map_key_to_rgss(key)
      case key.to_s.downcase
      when 'ok', 'enter' then [:C]
      when 'cancel', 'escape', 'menu' then [:B]
      when 'up' then [:UP]
      when 'down' then [:DOWN]
      when 'left' then [:LEFT]
      when 'right' then [:RIGHT]
      when 'shift' then [:A, :SHIFT]
      when 'pageup' then [:L]
      when 'pagedown' then [:R]
      when 'x' then [:X]
      when 'y' then [:Y]
      when 'z' then [:Z]
      else []
      end
    end

    def handle_remote_input(key, action)
      symbols = map_key_to_rgss(key)
      is_down = action.to_s == 'down'
      symbols.each do |sym|
        remote_keys_down[sym] = is_down
      end
    end

    def handle_remote_tap(norm_x, norm_y, phase)
      gw = defined?(Graphics) && Graphics.respond_to?(:width) ? Graphics.width : 544
      gh = defined?(Graphics) && Graphics.respond_to?(:height) ? Graphics.height : 416
      px = (norm_x.to_f * gw).to_i
      py = (norm_y.to_f * gh).to_i
      remote_mouse[:x] = px
      remote_mouse[:y] = py
      is_down = phase.to_s != 'up'
      remote_mouse[:down] = is_down
      remote_keys_down[:MOUSELEFT] = is_down
    end
  end
end

if defined?(Input)
  class << Input
    alias_method :chaya_raw_press?, :press? unless method_defined?(:chaya_raw_press?)
    alias_method :chaya_raw_trigger?, :trigger? unless method_defined?(:chaya_raw_trigger?)
    alias_method :chaya_raw_repeat?, :repeat? if method_defined?(:repeat?) && !method_defined?(:chaya_raw_repeat?)
    alias_method :chaya_raw_dir4, :dir4 if method_defined?(:dir4) && !method_defined?(:chaya_raw_dir4)
    alias_method :chaya_raw_dir8, :dir8 if method_defined?(:dir8) && !method_defined?(:chaya_raw_dir8)
    alias_method :chaya_raw_mouse_x, :mouse_x if method_defined?(:mouse_x) && !method_defined?(:chaya_raw_mouse_x)
    alias_method :chaya_raw_mouse_y, :mouse_y if method_defined?(:mouse_y) && !method_defined?(:chaya_raw_mouse_y)

    def press?(sym)
      return true if ChayaRGSS.remote_keys_down[sym]
      return false if ChayaRGSS.overlay_active?
      return false if ChayaRGSS.pointer_active? && ChayaRGSS.mouse_button?(sym)
      chaya_raw_press?(sym)
    end

    def trigger?(sym)
      return true if ChayaRGSS.remote_keys_down[sym] && !ChayaRGSS.remote_keys_prev[sym]
      return false if ChayaRGSS.overlay_active?
      return false if ChayaRGSS.pointer_active? && ChayaRGSS.mouse_button?(sym)
      chaya_raw_trigger?(sym)
    end

    def repeat?(sym)
      return true if ChayaRGSS.remote_keys_down[sym]
      return false if ChayaRGSS.overlay_active?
      return false if ChayaRGSS.pointer_active? && ChayaRGSS.mouse_button?(sym)
      defined?(chaya_raw_repeat?) ? chaya_raw_repeat?(sym) : false
    end

    def dir4
      r = ChayaRGSS.remote_keys_down
      return 2 if r[:DOWN]
      return 4 if r[:LEFT]
      return 6 if r[:RIGHT]
      return 8 if r[:UP]
      return 0 if ChayaRGSS.overlay_active?
      defined?(chaya_raw_dir4) ? chaya_raw_dir4 : 0
    end

    def dir8
      r = ChayaRGSS.remote_keys_down
      if r[:DOWN] && r[:LEFT] then return 1
      elsif r[:DOWN] && r[:RIGHT] then return 3
      elsif r[:UP] && r[:LEFT] then return 7
      elsif r[:UP] && r[:RIGHT] then return 9
      elsif r[:DOWN] then return 2
      elsif r[:LEFT] then return 4
      elsif r[:RIGHT] then return 6
      elsif r[:UP] then return 8
      end
      return 0 if ChayaRGSS.overlay_active?
      defined?(chaya_raw_dir8) ? chaya_raw_dir8 : 0
    end

    # Offscreen coordinates clear game hover, instead of freezing a hovered item.
    def mouse_x
      return ChayaRGSS.remote_mouse[:x] if ChayaRGSS.remote_mouse[:x] >= 0
      return -1 if ChayaRGSS.pointer_blocked?
      defined?(chaya_raw_mouse_x) ? chaya_raw_mouse_x : -1
    end

    def mouse_y
      return ChayaRGSS.remote_mouse[:y] if ChayaRGSS.remote_mouse[:y] >= 0
      return -1 if ChayaRGSS.pointer_blocked?
      defined?(chaya_raw_mouse_y) ? chaya_raw_mouse_y : -1
    end
  end
end
