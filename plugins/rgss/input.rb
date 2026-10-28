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
      return false if ChayaRGSS.overlay_active?
      return false if ChayaRGSS.pointer_active? && ChayaRGSS.mouse_button?(sym)
      chaya_raw_press?(sym)
    end

    def trigger?(sym)
      return false if ChayaRGSS.overlay_active?
      return false if ChayaRGSS.pointer_active? && ChayaRGSS.mouse_button?(sym)
      chaya_raw_trigger?(sym)
    end

    def repeat?(sym)
      return false if ChayaRGSS.overlay_active?
      return false if ChayaRGSS.pointer_active? && ChayaRGSS.mouse_button?(sym)
      defined?(chaya_raw_repeat?) ? chaya_raw_repeat?(sym) : false
    end

    def dir4
      return 0 if ChayaRGSS.overlay_active?
      defined?(chaya_raw_dir4) ? chaya_raw_dir4 : 0
    end

    def dir8
      return 0 if ChayaRGSS.overlay_active?
      defined?(chaya_raw_dir8) ? chaya_raw_dir8 : 0
    end

    # Offscreen coordinates clear game hover, instead of freezing a hovered item.
    def mouse_x
      return -1 if ChayaRGSS.pointer_blocked?
      defined?(chaya_raw_mouse_x) ? chaya_raw_mouse_x : -1
    end

    def mouse_y
      return -1 if ChayaRGSS.pointer_blocked?
      defined?(chaya_raw_mouse_y) ? chaya_raw_mouse_y : -1
    end
  end
end
