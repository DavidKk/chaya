# Read the same append-only game cache as the MV plugin. No translation engines
# or database scans run in the rendering path; lookups are in-memory hash reads.
begin
  require 'json'
rescue LoadError
  # Stock RGSS has no standard-library JSON.
end
load File.join(File.dirname(__FILE__), 'cache_json.rb') unless defined?(ChayaRGSS::CacheJSON)

module ChayaRGSS
  class TranslationStore
    attr_reader :revision, :rows

    def initialize(root)
      @root = root
      @rows = {}
      @index = {}
      @numeric = {}
      @revision = 0
      @offset = 0
      @tail = binary('')
    end

    def binary(text)
      text.respond_to?(:force_encoding) ? text.force_encoding('ASCII-8BIT') : text
    end

    def utf8(text)
      text.respond_to?(:force_encoding) ? text.force_encoding('UTF-8') : text
    end

    def normalize(text)
      value = text.gsub(/\r\n?/, "\n").sub(/^"+/, '').sub(/(?:"\);|"\))$/, '')
      value.respond_to?(:unicode_normalize) ? value.unicode_normalize(:nfkc) : value
    end

    def get(text)
      hit = @index[text] || @index[normalize(text)]
      return hit if hit
      query = /\A([A-Za-z]{2,60} ?)(\d{1,6})\z/.match(text)
      template = query && @numeric[query[1]]
      template ? template[0] + query[2] + template[1] : nil
    end

    # Match the service's conservative numeric-label rule. Build once on refresh,
    # and keep rendering to hash lookups rather than scanning cached rows.
    def numeric_index(rows)
      groups = {}
      rows.each do |s, row|
        source = /\A([A-Za-z]{2,60} ?)(\d{1,6})\z/.match(s)
        next unless source
        group = groups[source[1]] ||= { :numbers => {}, :templates => {}, :invalid => false }
        target = /\A([^\d\r\n\\]*)(\d+)([^\d\r\n\\]*)\z/.match(row['t'])
        han = target && binary((target[1] + target[3]).dup) =~ /(?:\xe3[\x90-\xbf]|[\xe4-\xe9][\x80-\xbf])[\x80-\xbf]/n
        if !target || target[2] != source[2] || !han
          group[:invalid] = true
          next
        end
        group[:numbers][source[2]] = true
        group[:templates][[target[1], target[3]]] = true
      end
      index = {}
      groups.each do |family, group|
        if !group[:invalid] && group[:numbers].size >= 2 && group[:templates].size == 1
          index[family] = group[:templates].keys.first
        end
      end
      index
    end

    def path_for(name, legacy)
      ([File.join(@root, 'chaya', 'translate', name)] + legacy.map { |file| File.join(@root, file) }).find { |file| File.file?(file) }
    end

    def signature(path)
      return nil unless path
      stat = File.stat(path)
      [path, stat.ino, stat.size, stat.mtime.to_f]
    end

    def apply(rows, value)
      row = value.is_a?(Array) ? { 's' => value[0], 't' => value[1] } : value
      return unless row.is_a?(Hash) && row['s'].is_a?(String) && (row['t'].nil? || row['t'].is_a?(String)) && row.key?('t')
      origin = row['origin']
      if origin
        return unless origin.is_a?(Hash) && origin['id'].is_a?(String) && origin['database'].is_a?(String) && origin['revision'].is_a?(Integer)
      end
      previous = rows[row['s']]
      if row['t'].nil?
        old = previous && previous['origin']
        rows.delete(row['s']) if !origin || (old && old['id'] == origin['id'] && old['database'] == origin['database'])
      elsif !origin || !previous || previous['origin']
        rows[row['s']] = row
      end
    end

    def refresh
      seed = path_for('seed.json', ['chaya-trans.seed.json', 'shiru-trans.seed.json', 'translate-both.seed.json'])
      cache = path_for('cache.ndjson', ['chaya-trans.cache.ndjson', 'shiru-trans.cache.ndjson', 'translate-both.cache.ndjson'])
      seed_sig, cache_sig = signature(seed), signature(cache)
      return false if @loaded && seed_sig == @seed_sig && cache_sig == @cache_sig
      rebuild = !@loaded || seed_sig != @seed_sig || !cache_sig || !@cache_sig ||
        cache_sig[0, 2] != @cache_sig[0, 2] || cache_sig[2] <= @cache_sig[2]
      rows = rebuild ? {} : @rows.dup
      offset, tail = rebuild ? [0, binary('')] : [@offset, @tail]
      if rebuild && seed
        values = CacheJSON.parse(utf8(File.open(seed, 'rb') { |file| file.read }))
        if values.is_a?(Hash)
          values.each { |s, t| apply(rows, { 's' => s, 't' => t }) if t.is_a?(String) && !t.empty? }
        end
      end
      if cache
        File.open(cache, 'rb') do |file|
          file.seek(offset)
          tail = tail + file.read(cache_sig[2] - offset).to_s
          offset = file.pos
        end
        lines = tail.split("\n", -1)
        tail = lines.pop || binary('')
        lines.each do |line|
          begin
            apply(rows, CacheJSON.parse(utf8(line)))
          rescue CacheJSON::ParseError
            # Ignore a corrupt completed row, keep processing subsequent events.
          end
        end
      end
      index = {}
      rows.each { |s, row| index[normalize(s)] = row['t'] unless row['t'].empty? }
      rows.each { |s, row| index[s] = row['t'] unless row['t'].empty? }
      numeric = numeric_index(rows)
      @rows, @index, @numeric = rows, index, numeric
      @offset, @tail = offset, tail
      @seed_sig, @cache_sig = seed_sig, cache_sig
      @loaded = true
      @revision += 1
      true
    end
  end
end
