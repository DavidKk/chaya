# mkxp-z discovers fonts bundled with the game, not Windows system fonts.
# Keep any available requested face; only substitute a wholly missing family.
module ChayaRGSS
  CHINESE_FONTS = [
    'Hiragino Sans GB',
    'HiraginoSansGB',
    'Hiragino Sans GB W3',
    'ChayaHeiti',
    'Heiti SC',
    'STHeiti Medium',
    'STHeitiMedium',
    'Arial Unicode MS',
    'ArialUnicodeMS',
    'Songti SC',
    'Songti',
    'Noto Sans CJK SC',
    'Microsoft YaHei',
    'SimHei',
    'Heiti TC',
    'VL PGothic',
    'VL Gothic',
    'Noto Sans CJK JP',
    'Noto Sans JP',
    'UmePlus Gothic'
  ].freeze

  @fallback_font = CHINESE_FONTS.find { |name| Font.exist?(name) }
  @missing_fonts = {}

  def self.fallback_font
    @fallback_font ||= CHINESE_FONTS.find { |name| Font.exist?(name) }
  end

  def self.font_name(name)
    fb = fallback_font
    return name unless fb && name
    names = name.is_a?(Array) ? name.dup : [name]
    has_chinese_font = names.any? { |family| family.is_a?(String) && Font.exist?(family) && CHINESE_FONTS[0..14].include?(family) }
    has_valid_font = names.any? { |family| family.is_a?(String) && Font.exist?(family) }

    unless has_valid_font
      unless @missing_fonts[name]
        System.puts("[Chaya RGSS] Missing font #{name.inspect}; using #{fb}")
        @missing_fonts[name] = true
      end
      return fb
    end

    if fb && !has_chinese_font && !names.include?(fb)
      names << fb
    end
    names.length == 1 ? names.first : names
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
