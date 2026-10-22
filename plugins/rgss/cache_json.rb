# A small JSON reader for stock RGSS, whose embedded Ruby has no JSON gem.
# Modern mkxp-z uses stdlib JSON when available. Never eval cache contents.
module ChayaRGSS
  module CacheJSON
    class ParseError < StandardError; end

    def self.parse(text)
      return ::JSON.parse(text) if defined?(::JSON)
      Reader.new(text).parse
    rescue StandardError => error
      raise ParseError, error.message
    end

    class Reader
      def initialize(text)
        @text, @pos = text, 0
      end

      def parse
        result = value
        whitespace
        raise ParseError, 'Unexpected trailing JSON' unless @pos == @text.length
        result
      end

      def whitespace
        @pos += 1 while @text[@pos, 1] && @text[@pos, 1] =~ /[\x20\t\r\n]/
      end

      def take(expected)
        whitespace
        raise ParseError, "Expected #{expected}" unless @text[@pos, expected.length] == expected
        @pos += expected.length
      end

      def value
        whitespace
        case @text[@pos, 1]
        when '"' then string
        when '{' then object
        when '[' then array
        when 't' then take('true'); true
        when 'f' then take('false'); false
        when 'n' then take('null'); nil
        else
          match = /\A-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.match(@text[@pos..-1])
          raise ParseError, 'Invalid JSON value' unless match
          @pos += match[0].length
          match[0] =~ /[.eE]/ ? match[0].to_f : match[0].to_i
        end
      end

      def hex
        digits = @text[@pos, 4]
        raise ParseError, 'Invalid Unicode escape' unless digits && digits =~ /\A[0-9a-fA-F]{4}\z/
        @pos += 4
        digits.to_i(16)
      end

      def string
        take('"')
        out = ''
        while @pos < @text.length
          char = @text[@pos, 1]
          @pos += 1
          return out if char == '"'
          if char == '\\'
            char = @text[@pos, 1]
            @pos += 1
            if char == 'u'
              code = hex
              if code >= 0xd800 && code <= 0xdbff
                take('\\u')
                low = hex
                raise ParseError, 'Invalid Unicode pair' unless low >= 0xdc00 && low <= 0xdfff
                code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00
              end
              raise ParseError, 'Unpaired Unicode surrogate' if code >= 0xd800 && code <= 0xdfff
              out << [code].pack('U')
            else
              escapes = { '"' => '"', '\\' => '\\', '/' => '/', 'b' => "\b", 'f' => "\f", 'n' => "\n", 'r' => "\r", 't' => "\t" }
              raise ParseError, 'Invalid JSON escape' unless escapes.key?(char)
              out << escapes[char]
            end
          else
            raise ParseError, 'Unescaped JSON control' if char =~ /[\x00-\x1f]/
            out << char
          end
        end
        raise ParseError, 'Unterminated JSON string'
      end

      def array
        take('[')
        result = []
        whitespace
        unless @text[@pos, 1] == ']'
          loop do
            result << value
            whitespace
            break unless @text[@pos, 1] == ','
            take(',')
          end
        end
        take(']')
        result
      end

      def object
        take('{')
        result = {}
        whitespace
        unless @text[@pos, 1] == '}'
          loop do
            key = string
            take(':')
            result[key] = value
            whitespace
            break unless @text[@pos, 1] == ','
            take(',')
          end
        end
        take('}')
        result
      end
    end
  end
end
