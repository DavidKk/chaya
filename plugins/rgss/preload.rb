# Native RGSS compatibility, loaded before the game's packed Ruby scripts.
# Upstream's CC0 wrapper is bundled with the SHA-256 verified mkxp-z build.
# Unknown Windows calls fail explicitly instead of pretending to succeed.
class Win32API
  TOLERATE_ERRORS = false
end

# A controlling terminal may disappear independently of the native game.
Signal.trap('HUP', 'IGNORE') rescue nil

runtime = ENV.fetch('CHAYA_RGSS_RUNTIME')
load File.join(runtime, 'scripts/preload/ruby_classic_wrap.rb')
load File.join(runtime, 'scripts/preload/win32_wrap.rb')

module ChayaRGSS
  @overlay_active = false
  class << self
    def overlay_active?
      !!@overlay_active
    end
    def overlay_active=(val)
      @overlay_active = !!val
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

    def press?(sym)
      return false if defined?(ChayaRGSS) && ChayaRGSS.overlay_active?
      chaya_raw_press?(sym)
    end

    def trigger?(sym)
      return false if defined?(ChayaRGSS) && ChayaRGSS.overlay_active?
      chaya_raw_trigger?(sym)
    end

    def repeat?(sym)
      return false if defined?(ChayaRGSS) && ChayaRGSS.overlay_active?
      defined?(chaya_raw_repeat?) ? chaya_raw_repeat?(sym) : false
    end

    def dir4
      return 0 if defined?(ChayaRGSS) && ChayaRGSS.overlay_active?
      defined?(chaya_raw_dir4) ? chaya_raw_dir4 : 0
    end

    def dir8
      return 0 if defined?(ChayaRGSS) && ChayaRGSS.overlay_active?
      defined?(chaya_raw_dir8) ? chaya_raw_dir8 : 0
    end
  end
end

module ChayaRGSS
  class Function
    def initialize(&block)
      @implementation = block
    end
    def call(*args)
      @implementation.call(*args)
    end
  end

  def self.function(&block)
    Function.new(&block)
  end

  def self.ini_value(section, key, fallback, file)
    current = ''
    value = fallback
    [file, File.join(ENV.fetch('CHAYA_RGSS_SESSION'), 'settings.ini')].each do |source|
      next unless File.file?(source.to_s)
      File.foreach(source) do |line|
        line = line.strip
        if line =~ /^\[(.+)\]$/
          current = $1.downcase
        elsif current == section.to_s.downcase && line.include?('=')
          name, text = line.split('=', 2)
          value = text if name.strip.downcase == key.to_s.downcase
        end
      end
    end
    value
  end

  def self.write_ini(section, key, value, _file)
    # Keep Windows-only UI preferences out of the original Game.ini.
    destination = File.join(ENV.fetch('CHAYA_RGSS_SESSION'), 'settings.ini')
    File.open(destination, 'a') { |file| file.write("\n[#{section}]\n#{key}=#{value}\n") }
    1
  end

  def self.bind(dll, name)
    library = File.basename(dll.to_s.tr('\\', '/')).sub(/\.dll$/i, '').downcase
    api = name.to_s.sub(/[AW]$/, '')
    if library == 'kernel32'
      case api
      when 'RtlZeroMemory'
        return function { |buffer, size| buffer[0, size] = "\0" * size; 0 }
      when 'GetPrivateProfileInt'
        return function { |section, key, fallback, file| ini_value(section, key, fallback, file).to_i }
      when 'GetPrivateProfileString'
        return function do |section, key, fallback, buffer, size, file|
          text = ini_value(section, key, fallback, file).to_s.b.byteslice(0, [size - 1, 0].max)
          buffer[0, text.bytesize + 1] = text + "\0"
          text.bytesize
        end
      when 'WritePrivateProfileString'
        return function { |*args| write_ini(*args) }
      when 'MultiByteToWideChar'
        return function do |page, _flags, source, length, buffer, size|
          bytes = length == -1 ? source.split("\0").first.to_s + "\0" : source.byteslice(0, length)
          text = bytes.dup.force_encoding(page == 65001 ? 'UTF-8' : 'Windows-31J').encode('UTF-16LE').b
          buffer[0, text.bytesize] = text if buffer && size * 2 >= text.bytesize
          text.bytesize / 2
        end
      when 'WideCharToMultiByte'
        return function do |page, _flags, source, length, buffer, size, *_rest|
          bytes = length == -1 ? source : source.byteslice(0, length * 2)
          text = bytes.dup.force_encoding('UTF-16LE').encode(page == 65001 ? 'UTF-8' : 'Windows-31J').b
          text = text.split("\0").first.to_s.b + "\0" if length == -1
          buffer[0, text.bytesize] = text if buffer && size >= text.bytesize
          text.bytesize
        end
      end
    elsif library == 'user32'
      return user32(api)
    elsif library == 'camouse'
      case api
      when 'GetWindowHandle'
        return function { 42 } # Matches upstream win32_wrap.rb's RGSS window handle.
      when 'GetWheelDelta'
        return function { Input.scroll_v * 120 }
      when 'DisposeHook', 'RegenerationHook'
        return function { 1 } # SDL already owns mouse events; no Windows hook is installed.
      end
    elsif library == 'tktk_bitmap'
      return function { |*args| ChayaRGSS.bitmap_call(api, args) }
    end
    nil
  end
end

class << Win32API
  alias_method :chaya_original_new, :new
  def new(dll, name, *signature)
    ChayaRGSS.bind(dll, name) || chaya_original_new(dll, name, *signature)
  end
end

load File.join(File.dirname(__FILE__), 'tktk_bitmap.rb')
load File.join(File.dirname(__FILE__), 'user32.rb')
load File.join(File.dirname(__FILE__), 'asset_paths.rb')
load File.join(File.dirname(__FILE__), 'font_fallback.rb')
load File.join(File.dirname(__FILE__), 'script_patches.rb')
load File.join(File.dirname(__FILE__), 'mouse_movement.rb')
load File.join(File.dirname(__FILE__), 'translation.rb')
System.puts('[Chaya RGSS] Native compatibility preload ready')
begin
  load File.join(File.dirname(__FILE__), 'bridge.rb')
rescue LoadError, StandardError => error
  System.puts("[Chaya RGSS] Optional bridge unavailable: #{error.class}")
end
