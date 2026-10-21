module TestMousePos
  Graphics.update rescue nil
  Input.update rescue nil
  puts "Input.mouse_in_window?: #{Input.mouse_in_window?}"
  puts "Input.mouse_x: #{Input.mouse_x}, Input.mouse_y: #{Input.mouse_y}"
end

