# Chaya：准备与启动游戏

## 准备

1. **local**（App / 本地开发）：游戏库选择 `www`、含它的发行目录，或含 macOS `.app` / Windows `Game.exe` 的包。自动识别 MV / MZ 内容根；移除游戏库条目只删记录。
2. **cloud**：用 Chrome / Microsoft Edge 授权读写含 `www` 或 `index.html` 的目录。
3. 游戏库详情安装共用 NW.js 壳（约 100 MB）；游戏自带壳时无需另装。
4. 安装插件；每次更新后重启游戏。本机启动也会自动注入插件。

macOS 壳打不开时，退出游戏，在终端执行并按提示选目录；完成后打开 `Chaya.app`。保留存档并备份旧壳：

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## 插件与使用

`ChayaLoader` 加载插件并支持离线缓存，`ChayaLog` 记录日志，`ChayaTrans` 翻译，`ChayaBoost` 加速（`on()` / `off()`），`ChayaEdit` 修改、传送与存读档（`help()`），`ChayaAgent` 桥接游戏控制。

- **local**：游戏库点“启动”，写入会话配置并打开游戏；插件连接本机服务，控制台显示在线状态。
- **cloud**：准备后双击游戏目录旁 `Chaya.app` / `Chaya`；经 WebRTC 通信，网页不能启动进程。
- 修改（`/cheat`）：金钱、物品、变量、开关、角色、无敌、穿墙、速度、传送、存读档；局内快捷键打开同一面板。
- 翻译（`/translate`）：抽取 seed → 按启用的引擎和调度配置运行整作补译，可暂停；缓存支持浏览、搜索、编辑、删除、导入。局内支持预翻译、实时、字幕。Cloud 作业由在线游戏执行，本机共享库需本机服务。
- 日志（`/logs`）：按来源、级别排查插件、翻译与连接错误。控制台退出或关闭窗口均可；代用户退出、破坏性修改、清插件、覆盖存档或读档前先征得同意。

## 排错

缺壳则先安装；插件无效则重装、重启并查 `ChayaLoader` 日志。离线时确认 `ChayaAgent` 已加载及连接配置正确，再刷新控制台。macOS 必要时用上方修复命令。
