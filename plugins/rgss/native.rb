# Stock Windows RGSS entry, inserted immediately before the game's Main script.
# Does not load mkxp-z compatibility adapters or the macOS WebView host.
root = File.join(Dir.pwd, 'chaya', 'plugins', 'rgss')
load File.join(root, 'translation.rb') unless defined?(ChayaRGSS::Translation)
ChayaRGSS::Translation.install
