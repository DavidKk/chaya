# A virtual RGSS window backed by mkxp-z/SDL, not macOS window handles.
module ChayaRGSS
  def self.user32(api)
    case api
    when 'FindWindow', 'GetForegroundWindow', 'GetActiveWindow'
      function { 42 }
    when 'GetDesktopWindow'
      function { 1 }
    when 'GetWindowLong'
      function { |_handle, _index| 0 } # No Win32 non-client frame / extended style.
    when 'GetSystemMetrics'
      function do |index|
        case index
        when 0, 16 then Graphics.display_width
        when 1, 17 then Graphics.display_height
        when 23 then 0 # SM_SWAPBUTTON: normal mouse button mapping
        else 0 # No Windows caption, frame or scrollbar dimensions.
        end
      end
    when 'GetWindowRect'
      function do |handle, buffer|
        width = handle == 1 ? Graphics.display_width : (@window_width || Graphics.width)
        height = handle == 1 ? Graphics.display_height : (@window_height || Graphics.height)
        buffer.replace([0, 0, width, height].pack('l4'))
        1
      end
    when 'GetClientRect'
      function do |_handle, buffer|
        width = @window_width || Graphics.width
        height = @window_height || Graphics.height
        buffer.replace([0, 0, width, height].pack('l4'))
        1
      end
    when 'GetCursorPos'
      function do |buffer|
        mx = (defined?(Input) && Input.respond_to?(:mouse_x)) ? Input.mouse_x : 0
        my = (defined?(Input) && Input.respond_to?(:mouse_y)) ? Input.mouse_y : 0
        buffer.replace([mx, my].pack('ll'))
        1
      end
    when 'ScreenToClient'
      function { |_handle, _buffer| 1 } # Virtual window origin is (0, 0).
    when 'ClientToScreen'
      function { |_handle, _buffer| 1 } # Virtual window origin is (0, 0).
    when 'GetAsyncKeyState'
      function do |key|
        pressed = false
        if defined?(Input)
          case key
          when 1 # VK_LBUTTON
            pressed = Input.press?(Input::MOUSELEFT) if defined?(Input::MOUSELEFT)
          when 2 # VK_RBUTTON
            pressed = Input.press?(Input::MOUSERIGHT) if defined?(Input::MOUSERIGHT)
          when 4 # VK_MBUTTON
            pressed = Input.press?(Input::MOUSEMIDDLE) if defined?(Input::MOUSEMIDDLE)
          when 5 # VK_XBUTTON1
            pressed = Input.press?(Input::MOUSEX1) if defined?(Input::MOUSEX1)
          when 6 # VK_XBUTTON2
            pressed = Input.press?(Input::MOUSEX2) if defined?(Input::MOUSEX2)
          end
        end
        pressed ? 0x8000 : 0
      end
    when 'SetWindowPos'
      function do |_handle, _order, _x, _y, width, height, flags|
        if flags & 1 == 0 && width > 0 && height > 0
          @window_width, @window_height = width, height
          Graphics.resize_window(width, height)
        end
        Graphics.center if flags & 2 == 0
        1
      end
    when 'SystemParametersInfo'
      function do |action, _param, buffer, _flags|
        raise NotImplementedError, "Chaya RGSS: SystemParametersInfo #{action}" unless action == 0x30
        buffer.replace([0, 0, Graphics.display_width, Graphics.display_height].pack('l4'))
        1
      end
    when 'SetCursorPos'
      function { |_x, _y| 0 } # Report failure: do not move the user's global macOS cursor.
    when 'ShowCursor'
      # Win32 returns a signed display counter, not the boolean SDL visibility.
      # Keep it shared across API instances, as it belongs to the window thread.
      function do |show|
        @cursor_count = (@cursor_count || 0) + (show == 0 ? -1 : 1)
        Graphics.show_cursor = @cursor_count >= 0
        @cursor_count
      end
    when 'MessageBox'
      function { |_handle, message, _title, _flags| msgbox(message); 1 }
    end
  end
end

