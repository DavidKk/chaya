# mkxp-z discovers fonts bundled with the game, not Windows system fonts.
# Keep any available requested face; only substitute a wholly missing family.
module ChayaRGSS
  @fallback_font = ['VL PGothic', 'VL Gothic', 'Noto Sans CJK JP', 'Noto Sans JP', 'UmePlus Gothic'].find { |name| Font.exist?(name) }
  @missing_fonts = {}

  def self.font_name(name)
    return name unless @fallback_font && name
    names = name.is_a?(Array) ? name : [name]
    return name if names.any? { |family| family.is_a?(String) && Font.exist?(family) }
    unless @missing_fonts[name]
      System.puts("[Chaya RGSS] Missing font #{name.inspect}; using #{@fallback_font}")
      @missing_fonts[name] = true
    end
    @fallback_font
  end
end

class Font
  alias_method :chaya_native_initialize, :initialize
  def initialize(*args)
    args[0] = ChayaRGSS.font_name(args[0]) unless args.empty?
    chaya_native_initialize(*args)
  end

  alias_method :chaya_native_name=, :name=
  def name=(value)
    self.chaya_native_name = ChayaRGSS.font_name(value)
  end
end

class << Font
  alias_method :chaya_native_default_name=, :default_name=
  def default_name=(value)
    self.chaya_native_default_name = ChayaRGSS.font_name(value)
  end
end

Font.default_name = Font.default_name
