# Translate only display fields after RGSS has decoded event data.
module ChayaRGSS
  module DataTranslation
    class << self
      def reset
        @groups = {}
        @revision = nil
      end

      def install
        return if Object.method_defined?(:chaya_translation_load_data) || Object.private_method_defined?(:chaya_translation_load_data)
        return unless Object.method_defined?(:load_data) || Object.private_method_defined?(:load_data)
        Object.class_eval do
          alias_method :chaya_translation_load_data, :load_data
          def load_data(filename)
            result = chaya_translation_load_data(filename)
            ChayaRGSS::DataTranslation.loaded(filename, result)
            result
          end
          private :load_data, :chaya_translation_load_data
        end
      end

      def loaded(filename, data)
        path = filename.to_s.tr('\\', '/')
        group = if path =~ /(?:\A|\/)Data\/Map\d+\.(?:rvdata2?|rxdata)\z/i
          'map'
        elsif path =~ /(?:\A|\/)Data\/CommonEvents\.(?:rvdata2?|rxdata)\z/i
          'common'
        elsif path =~ /(?:\A|\/)Data\/Troops\.(?:rvdata2?|rxdata)\z/i
          'troops'
        end
        return unless group
        capture(group, data)
      rescue StandardError => error
        Translation.report(error)
      end

      def capture(group, data)
        @groups ||= {}
        existing = @groups[group]
        return if existing && existing[:root].equal?(data)
        fields = []
        lists = []
        if group == 'map'
          if data.respond_to?(:events) && data.events.is_a?(Hash)
            data.events.each_value { |event| collect_pages(event, lists) }
          end
        elsif data.is_a?(Array)
          data.compact.each do |entry|
            if group == 'common'
              lists << entry.list if entry.respond_to?(:list)
            else
              collect_pages(entry, lists)
            end
          end
        end
        lists.each do |list|
          next unless list.is_a?(Array)
          list.each do |command|
            next unless command.respond_to?(:code) && command.respond_to?(:parameters)
            parameters = command.parameters
            next unless parameters.is_a?(Array)
            if command.code == 401 || command.code == 405 || (command.code == 101 && parameters.length == 1)
              remember(fields, parameters, 0)
            elsif command.code == 102 && parameters[0].is_a?(Array)
              parameters[0].each_index { |index| remember(fields, parameters[0], index) }
            end
          end
        end
        @groups[group] = { :root => data, :fields => fields }
        Translation.debug('data_load', group, { 'fields' => fields.length })
        apply(fields)
      end

      def collect_pages(entry, lists)
        return unless entry.respond_to?(:pages) && entry.pages.is_a?(Array)
        entry.pages.compact.each { |page| lists << page.list if page.respond_to?(:list) }
      end

      def remember(fields, array, index)
        value = array[index]
        return unless value.is_a?(String) && !array.frozen?
        fields << { :array => array, :index => index, :source => value.dup.freeze, :last => value.dup }
      end

      def apply(fields)
        fields.delete_if do |field|
          array, index = field[:array], field[:index]
          # A game script may own a subsequent edit; do not overwrite it.
          next true if array.frozen? || array[index] != field[:last]
          target = Translation.translate(field[:source])
          array[index] = target.dup if array[index] != target
          field[:last] = target.dup
          false
        end
      end

      def refresh
        @groups ||= {}
        # Also covers a plugin hot reload after the database was loaded.
        capture('map', $data_map) if defined?($data_map) && $data_map
        capture('common', $data_common_events) if defined?($data_common_events) && $data_common_events
        capture('troops', $data_troops) if defined?($data_troops) && $data_troops
        store = Translation.store
        return unless store
        revision = [store.revision, Translation.play_mode, Translation.preview_original?]
        return if revision == @revision
        @groups.each_value { |group| apply(group[:fields]) }
        @revision = revision
      rescue StandardError => error
        Translation.report(error)
      end
    end
  end
end
