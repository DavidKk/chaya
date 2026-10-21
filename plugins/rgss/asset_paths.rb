# mkxp-z's native path cache is disabled for encrypted-archive compatibility.
# Resolve loose asset names case-insensitively, as Windows RGSS does, without
# renaming files or extracting the game's archive.
module ChayaRGSS
  @asset_paths = {}
  def self.asset_path(file, extensions)
    return file unless file.is_a?(String) && !file.empty?
    normalized = file.tr('\\', '/')
    key = [normalized.downcase, extensions]
    return @asset_paths[key] if @asset_paths.key?(key)
    return file unless File.directory?(File.dirname(File.expand_path(normalized))) || !normalized.start_with?('/')
    parts = normalized.split('/').reject { |part| part.empty? || part == '.' }
    directory = normalized.start_with?('/') ? '/' : '.'
    parts.each_with_index do |part, index|
      return normalized unless File.directory?(directory)
      names = Dir.entries(directory)
      candidates = index == parts.length - 1 ? [part] + extensions.map { |extension| part + extension } : [part]
      found = candidates.lazy.map { |candidate| names.find { |name| name.downcase == candidate.downcase } }.find { |name| name }
      return normalized unless found
      directory = File.join(directory, found)
    end
    @asset_paths[key] = directory
  end

end

# Alias at the native layer. prepend would interfere with legacy scripts that
# alias initialize repeatedly and could make those aliases recursively re-enter.
class Bitmap
  alias_method :chaya_native_initialize, :initialize
  def initialize(*args)
    args[0] = ChayaRGSS.asset_path(args[0], ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp']) if args[0].is_a?(String)
    chaya_native_initialize(*args)
  end
end

[:bgm_play, :bgs_play, :me_play, :se_play].each do |method|
  Audio.singleton_class.class_eval do
    alias_method "chaya_native_#{method}", method
    define_method(method) do |file, *args|
      send("chaya_native_#{method}", ChayaRGSS.asset_path(file, ['.ogg', '.wav', '.mp3', '.m4a', '.flac', '.mid']), *args)
    end
  end
end

class << Graphics
  alias_method :chaya_native_transition, :transition
  def transition(duration = 10, file = '', vague = 40)
    chaya_native_transition(duration, ChayaRGSS.asset_path(file, ['.png', '.jpg']), vague)
  end
end
