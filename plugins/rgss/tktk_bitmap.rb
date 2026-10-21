# Targeted tktk_bitmap bridge. RGSS object IDs are resolved as Ruby objects;
# native Windows pointers are never passed into the macOS process.
module ChayaRGSS
  def self.bitmap_call(api, args)
    if api == 'PngSave' || api == 'PngSaveA'
      ObjectSpace._id2ref(args[1]).to_file(args[0])
      return 0
    end
    bitmap = ObjectSpace._id2ref(args[0])
    case api
    when 'Blur'
      args[1].times { bitmap.blur }
    when 'GetPixelData'
      # mkxp-z exposes RGBA; this DLL's marshaled format is BGRA.
      args[1].replace(bitmap.raw_data.bytes.each_slice(4).map { |r, g, b, a| [b, g, r, a].pack('C4') }.join)
    when 'SetPixelData'
      bitmap.raw_data = args[1].bytes.each_slice(4).map { |b, g, r, a| [r, g, b, a].pack('C4') }.join
    when 'InvertColor', 'ChangeTone'
      bytes = bitmap.raw_data.bytes
      bytes.each_slice(4).with_index do |pixel, index|
        3.times do |channel|
          bytes[index * 4 + channel] = if api == 'InvertColor'
            255 - pixel[channel]
          else
            [[pixel[channel] + args[channel + 1], 0].max, 255].min
          end
        end
      end
      bitmap.raw_data = bytes.pack('C*')
    when 'ClipMask'
      mask = ObjectSpace._id2ref(args[1])
      ox = args[2] || 0
      oy = args[3] || 0
      outer = args[4] || 0
      bw = bitmap.width
      bh = bitmap.height
      mw = mask.width
      mh = mask.height
      dst_bytes = bitmap.raw_data.bytes
      mask_bytes = mask.raw_data.bytes
      bh.times do |y|
        my = y - oy
        bw.times do |x|
          mx = x - ox
          idx = (y * bw + x) * 4
          if mx >= 0 && mx < mw && my >= 0 && my < mh
            midx = (my * mw + mx) * 4
            mask_a = mask_bytes[midx + 3]
            dst_bytes[idx + 3] = (dst_bytes[idx + 3] * mask_a) / 255
          elsif outer == 0
            dst_bytes[idx + 3] = 0
          end
        end
      end
      bitmap.raw_data = dst_bytes.pack('C*')
    when 'BlendBlt'
      raise NotImplementedError, 'Chaya RGSS: tktk_bitmap non-normal blending needs adaptation' unless args[8] == 0
      source = ObjectSpace._id2ref(args[3])
      bitmap.blt(args[1], args[2], source, Rect.new(*args[4, 4]), args[9])
    else
      raise NotImplementedError, "Chaya RGSS: tktk_bitmap.#{api} needs adaptation"
    end
    0
  end
end

