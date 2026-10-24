require 'fiddle'
require 'json'

module ChayaRGSS
  module NativeWebview
    class << self
      def start
        return if @library
        root = File.dirname(__FILE__)
        library = File.join(root, 'dist', RUBY_PLATFORM.include?('darwin') ? 'libchaya-overlay.dylib' : 'chaya-overlay.dll')
        raise LoadError, "Chaya RGSS native overlay is missing: #{library}" unless File.file?(library)
        handle = Fiddle.dlopen(library)
        @create = Fiddle::Function.new(handle['chaya_overlay_create'], [Fiddle::TYPE_VOIDP, Fiddle::TYPE_VOIDP], Fiddle::TYPE_INT)
        @poll = Fiddle::Function.new(handle['chaya_overlay_poll'], [Fiddle::TYPE_VOIDP, Fiddle::TYPE_INT], Fiddle::TYPE_INT)
        @eval = Fiddle::Function.new(handle['chaya_overlay_eval'], [Fiddle::TYPE_VOIDP], Fiddle::TYPE_VOID)
        @dispose = Fiddle::Function.new(handle['chaya_overlay_dispose'], [], Fiddle::TYPE_VOID)
        config = JSON.generate({
          'roomId' => ENV.fetch('CHAYA_RGSS_ROOM'),
          'apiBase' => ENV.fetch('CHAYA_RGSS_API'),
          'launchToken' => ENV.fetch('CHAYA_RGSS_TOKEN'),
          'linkToken' => ENV.fetch('CHAYA_LINK_TOKEN', ''),
          'contentRoot' => ENV.fetch('CHAYA_RGSS_CONTENT_ROOT', '')
        })
        html = File.join(root, 'dist', 'rgss-overlay.html')
        raise 'Chaya RGSS overlay HTML is missing' unless @create.call(html, config) == 1
        @library = handle # Keep the dylib and callbacks alive for the entire session.
        @buffer = "\0" * (256 * 1024 + 1)
        @ready = false
        at_exit { @dispose.call if @library }
      end

      def pump
        return unless @library
        16.times do
          length = @poll.call(@buffer, @buffer.bytesize)
          break if length <= 0
          raw = @buffer.byteslice(0, length)
          packet = JSON.parse(raw)
          if packet['type'] == 'host.ready'
            @ready = true
          else
            ChayaRGSS::Bridge.receive_from_webview(packet)
          end
        end
      end

      def ready?
        !!@ready
      end

      def eval_js(source)
        @eval.call(source) if @library && @ready
      end
    end
  end
end
