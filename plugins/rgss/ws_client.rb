# Minimal RFC 6455 WebSocket client for Chaya RGSS bridge.
# Uses Ruby standard socket without any external gems.
require 'socket'
require 'json'

module ChayaRGSS
  module WSClient
    class << self
      def connect(host, port, path = '/')
        s = TCPSocket.new(host, port)
        key = 'dGhlIHNhbXBsZSBub25jZQ=='
        req = "GET #{path} HTTP/1.1\r\nHost: #{host}:#{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: #{key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        s.write(req)
        status_line = s.gets
        return nil unless status_line && status_line.include?('101')
        while (line = s.gets)
          break if line == "\r\n"
        end
        s
      rescue StandardError
        nil
      end

      def send_text(socket, text)
        bytes = text.to_s.b.bytes
        len = bytes.length
        frame = [0x81]
        mask_key = 4.times.map { rand(256) }
        if len <= 125
          frame << (0x80 | len)
        elsif len <= 65535
          frame << (0x80 | 126)
          frame.concat([len].pack('n').bytes)
        else
          frame << (0x80 | 127)
          frame.concat([len].pack('Q>').bytes)
        end
        frame.concat(mask_key)
        masked = bytes.each_with_index.map { |b, i| b ^ mask_key[i % 4] }
        frame.concat(masked)
        socket.write(frame.pack('C*'))
      end

      def read_text(socket)
        b1 = socket.getbyte or return nil
        b2 = socket.getbyte or return nil
        opcode = b1 & 0x0F
        if opcode == 0x8
          return nil
        elsif opcode == 0x9
          len = b2 & 0x7F
          socket.read(len) if len > 0
          socket.write([0x8A, 0x00].pack('C*'))
          return ''
        end
        len = b2 & 0x7F
        if len == 126
          raw = socket.read(2) or return nil
          len = raw.unpack('n')[0]
        elsif len == 127
          raw = socket.read(8) or return nil
          len = raw.unpack('Q>')[0]
        end
        payload = socket.read(len) or return nil
        payload.force_encoding('UTF-8')
      end
    end
  end
end

