# 翻译测试游戏

运行 `pnpm demo:game`。命令先构建当前插件，再启动独立的 Electron 游戏窗口；不需要先启动 Chaya Web 服务。游戏内容和翻译库放在仓库根目录的 `demos/simple-game/www/`，不会写入真实游戏目录。选择游戏时可选择 `demos/simple-game`。

默认启用实时翻译，翻译设置保存在 `demos/simple-game/www/chaya/config/translation-play.json`。使用上下键或鼠标切换场景，观察原文、词库命中、异步补译和右下角状态。快速切换可以测试上一段请求的取消；回到同一段可以检查词库复用。`長い手紙を読む` 用于检查长文本跳过。点击“插件面板”后切换到“翻译”，可以查看设置和活动日志。

本 Demo 使用最小 RPG Maker 兼容场景驱动真实 ChayaLoader、ChayaTrans 和 ChayaEdit 插件。它覆盖对话、选项与字幕钩子的调试链路，但不包含完整 RPG Maker 地图或战斗引擎。翻译结果保存在 `demos/simple-game/www/chaya/translate/cache.ndjson`，重启后仍可用于词库命中。
