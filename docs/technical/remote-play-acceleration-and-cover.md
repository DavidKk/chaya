# 远程串流：封面、预览与 MV/VX 性能技术方案

- **日期**：2026-11-01
- **状态**：代码对照评审后方案；实现状态与实测结果见末节。
- **对应需求**：[需求文档](../remote-play-acceleration-and-cover.md)
- **有效范围**：本地 Node 服务、MV/MZ 插件、macOS RGSS 原生宿主与 WebKit 网关。原生实时采集首阶段不是跨平台能力。
- **优先级**：旧静默方案的 4–8ms 端到端延迟、无头必定 60 FPS、同游戏禁止观看等描述由本轮需求更正。

## 1. 评审修正

| 原描述                                        | 问题                                       | 修正                                          |
| --------------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| 180秒 Ruby 截图 + 3秒网关轮询即实现 VX 加速   | 实时视频源仍是旧帧                         | 预览和实时采集独立；实时改原生内存桥接        |
| 4–8ms RTT 是端到端输入延迟                    | 遗漏输入、游戏渲染、编码、解码与显示       | RTT 仅是网络/通道往返统计；操作延迟需独立测量 |
| 14ms 心跳保证60帧，禁用跳帧更快               | RAF 与定时器可能交错重复更新；弱机可能过载 | 双时钟保护，不修改全局 `_maxSkip`             |
| 隐藏必定落到 E 核/1–5FPS                      | 没有采样证据，系统调度也不是固定映射       | 作为需对照验证的节流风险                      |
| 16Mbps + playoutDelayHint=0 消除缓冲          | 码率为上限，提示受实现和网络限制           | 保留自适应；按支持探测，并记录真实统计        |
| ScreenCaptureKit + VideoToolbox 直接变 WebRTC | 缺少编码后帧注入、RTP 与协商实现           | 首阶段复用 WebKit 编码，完整原生发送另立阶段  |
| 100%封面、0磁盘I/O、硬件声卡断开              | 缺素材/归档不可读；仍需读磁盘；仅改音频图  | 有界回退、无解密写盘、说明 WebAudio 范围      |
| JSON 返回 data 字段，示例代码省略字符串引号   | 不符 `apiOk({ cover })`，代码不可运行      | 保留真实信封，删除重复实现伪代码              |

## 2. 采集链路

```text
静态封面: 素材/存档 -> cover service -> 私有缓存 -> /play 与卡片
低频预览: screenshot service(每房间180秒缓存/并发合并) -> 无封面卡片
MV 实时: 游戏 Canvas + WebAudio -> MediaStream -> RTCPeerConnection
RGSS 实时首阶段(macOS):
  游戏窗口 -> ScreenCaptureKit -> 内存 JPEG -> WebKit Canvas -> MediaStream -> WebRTC
  (后台串行编码队列 + 单帧背压；不经 Ruby 截图/磁盘/管理页截图 API)
```

首阶段 RGSS 仍有 JPEG 编码、Base64、JS 解码和浏览器视频编码的开销，不能称为零拷贝或最终性能形态。目标先消除 Ruby 主循环截图与文件轮询，再以实测决定后续原生编码投入。

## 3. 封面解析与缓存

落点：`services/game/cover.ts`、`app/api/game/cover/route.server.ts`、`components/remote-play/useRemoteCover.ts`。

- 仅接受游戏库中已知的本地 ID；未知 ID 不回退当前选中游戏，远端项不读本地文件。
- 配置、素材路径都必须位于真实内容目录内；文件上限12MiB、解码像素上限3200万、输出最长边1280、不放大。
- MV/MZ 按背景层再前景层探测；同层先普通PNG，再加密格式。首个有效图即返回；本轮不合成标题两层，不解析脚本菜单。
- 加密格式校验32位十六进制密钥、16字节 RPGMV 签名、文件长度；去掉16字节签名后 XOR 前16字节。错误密钥/损坏文件交给图片验证并回退，不写明文文件。
- RGSS 仅探测松散标题目录，按确定顺序尝试候选，坏图不能阻断整个目录。加密归档/RTP素材不声明支持。
- 服务端缓存按库ID与内容目录区分，成功180秒、无图30秒；最多32项和16MiB字符串数据，并合并同键并发。库路径改变立即形成新键；原路径素材更新在服务TTL后可重读，但浏览器仍可能缓存24小时。
- 客户端先请求静态图，历史视频帧只做等待/无封面回退。静态图成功后不再截视频；兜底视频截帧限频180秒，仅处理已接收的视频，不请求主机。
- `raw=1` 返回图片，响应MIME取实际数据（存档回退未必是JPEG）；私有缓存 `private, max-age=86400`。无图的raw响应返回404且no-store；JSON继续 `{ ok: true, cover: string | null }`。现有 `game` 别名及省略ID取选中游戏行为保留，客户端始终传明确ID。

## 4. 低频预览服务

落点：`services/runtime/game-instance-manager.ts` 现有入口，缓存实现可独立模块；`app/api/remote/screenshot/route.ts` 不再被RGSS实时链路调用。

- 按基础房间号缓存180秒，`:observer`归一到同一房间。宽度限制在合理范围，避免非法尺寸；同房间并发共用一次采集。
- 缓存成功结果与失败结果，失败不导致多标签页轮流触发3秒Agent超时；缓存有界并在实例退出时回收或TTL淘汰。
- RGSS读取已有低频预览文件；MV通过`game.snap`采一张。静态封面由封面接口提供，不包装成实时截图，也不伪造640×360尺寸。
- Ruby中的低频预览仍允许180秒一次，后续可以改按需；它不能承担实时推流。前端有静态封面不请求此接口，后台页暂停刷新。

## 5. MV/MZ 调度与传输

### 5.1 渲染

保留`SceneManager`/PIXI原生调度，记录`lastNativeUpdate`与`lastAnyUpdate`。60Hz定时器仅在原生更新已停顿（至少50ms）且距离任意更新达到一帧间隔时补帧。补帧禁止`requestUpdate()`额外排入RAF；原生恢复立即优先。尊重`_stopped`/ticker停止，不修改`Graphics._maxSkip`。

该机制减少重复推进风险，但不能控制系统合成器、系统睡眠或浏览器定时器暂停。可见、遮挡、隐藏、最小化和锁屏分别测试。

### 5.2 启动与音频

保留已有防后台节流参数；不凭标志名称断言有效。移除未经验证的强制2GiB显存预算、100% WebRTC CPU和强制GPU路线，普通可见启动不增加额外参数；串流需要的参数按现有silent选项注入。`window.show`历史残留修复必须保留可见启动恢复能力，不把默认切回前台当作后台修复。

WebAudio静音只断开主增益到当前AudioContext的destination边，不清空所有连接；保留到串流destination的连接。上下文或流重建时重新绑定音轨，不复用已结束的轨道。局部插件音频、HTMLAudio、RGSS音频需另测。

### 5.3 传输

保留H.264优先和浏览器回退；码率上限、60FPS上限与`degradationPreference`均是提示/限制而非实际吞吐保证。`degradationPreference`属于sender parameters而不是单个encoding。不强迫弱网保持16Mbps。

接收端探测`jitterBufferTarget`及兼容提示，分别容错。设置0表示请求尽量降低延迟，实际目标仍受浏览器、网络与音画同步约束。使用`getStats()`区分收帧、解码、丢帧、丢包、冻结与抖动缓冲；增量均值为`delta(jitterBufferDelay)/delta(jitterBufferEmittedCount)`。

### 5.4 主机设置与启动契约

- `GET /api/remote/settings` 返回 `{ ok: true, settings: { launchMode, muteHostAudio } }`；`PUT` 接收 `{ settings: { ...partial } }`，复用管理访问校验和磁盘模式限制，返回完整合并结果。非法字段值返回400，损坏的落盘文件返回500，不静默覆盖。
- 通过公共配置存储原子写入 `<toolkitDataDir>/remote-play/settings.json`。`launchMode` 为 `windowed | silent`，默认 `windowed`；`muteHostAudio` 默认 `true`。其他已有浏览器偏好仍保持原存储方式。
- 串流页以 `POST /api/launch { remotePlay: true }` 请求服务端设置，不再采用浏览器旧的启动模式。普通本地启动无此标记，保持既有行为；兼容旧请求 `{ mode: "silent" }`。运行中实例仍优先复用，不热切换窗口或重写环境。
- MV/MZ 将窗口模式写入 `CHAYA_SILENT_MODE`，将独立声音偏好写入 `__CHAYA_UNMUTE_HOST__ = !muteHostAudio`。不传声音偏好的普通启动会清理该全局旧值，继续使用既有音频策略。
- RGSS 通过 `CHAYA_RGSS_SILENT` / `CHAYA_SILENT_MODE` 控制窗口，独立通过 `CHAYA_MUTE_HOST_AUDIO=1|0` 控制主机声音；静音保留音频位置查询、停止和渐变方法，只拦截播放入口，避免脚本类型错误。未提供新环境变量时保留旧静默回退。当前仍没有 RGSS 客户端音频采集。
- 设置在下一次启动时生效；UI 加载失败禁止误写，保存期间禁用重复提交，失败保留已确认的值并提示。未启动真实游戏验证的后台效果，仍按第10.2节列为未验收。

## 6. RGSS 原生采集首阶段

落点：`plugins/rgss/native/`独立采集文件、宿主`host.mm`注册桥接、`plugins/rgss/src/`独立帧源与现有网关集成。避免把超过600行的网关继续堆大。

### 6.1 原生帧源

- macOS12.3+按运行时能力检查；构建弱链接ScreenCaptureKit，链接CoreMedia/CoreVideo/CoreImage/ImageIO。macOS14.4+优先`getCurrentProcessShareableContentWithCompletionHandler`枚举本进程窗口；12.3–14.3使用旧枚举API，可能需要屏幕录制权限，该分支尚未实机验收。
- 只捕获宿主已附着的游戏窗口ID，不按标题抓取其他应用。使用独立窗口filter。静默窗口保持alpha=1并移至屏幕外；实测alpha=0只收到初始帧，不能把完全透明作为后台渲染方案。
- 不启动时不申请屏幕录制，不自动反复弹权限；由用户建立串流后启动采集，拒绝/不可用须回报英文诊断状态。
- 有实时消费者时启动SCStream，输出按附着窗口内容区域比例设置，当前目标固定30FPS、最长边1280、JPEG质量0.72、采集队列深度3；不承诺与MV的60FPS上限一致。运行中改变游戏窗口尺寸尚需额外验证。
- SCStream回调在串行后台队列编码；只允许一帧等待WebKit消费，解码/绘制后ACK，忙时丢旧帧。ACK有超时，断开不遗留队列。
- 调用链不得等待Ruby主线程；JS不读`file://current_frame.jpg`，也不高频请求`/api/remote/screenshot`。

### 6.2 生命周期与错误

主控制连接与观察连接共享一个帧源。轨道建立后允许开始预热；全部peer关闭时停止SCStream、结束activity token、清Canvas轨道和回调。重连使用generation丢弃上一轮异步回调。同一peer的新offer不能误杀另一个观看peer的采集。

启动失败、首帧超时、窗口销毁、权限拒绝和SCStream停止均须记录原因；无实时帧时不回退静态封面冒充视频。Windows WebView2及不支持的macOS尚无本轮原生视频后端；仅数据通道连接不需要启动采集，但请求视频会明确失败，不能声明本轮已加速。

### 6.3 后续原生编码

CVPixelBuffer接VideoToolbox并不等于WebRTC。后续需选择原生libwebrtc等可维护实现，补齐SDP/ICE/DTLS/SRTP/RTP、关键帧请求、拥塞控制、时间戳与音频同步，并验证硬编实际生效。锁屏、睡眠、零拷贝均单独验收。

## 7. 接口与兼容

- `GET /api/game/cover?gameId=...`：`{ "ok": true, "cover": "data:image/jpeg;base64,..." }`或`cover:null`；图片请求见第3节。
- `GET /api/remote/instances`：保留`apiOk({ instances })`现有字段；卡片按`libraryId`请求封面，无需为优化变更实例ID或房间ID。
- `GET /api/remote/screenshot?roomId=...`：只提供缓存预览，响应继续为图片/占位；不改变现有控制权与鉴权规则。不会成为实时传输接口。
- 本地原生桥接：`host.stream`启停、`host.stream.ack`确认，回调包含会话代次与frame/error。只能由已绑定主frame的WebView调用，不经过公共API，也不带凭据到日志。

## 8. 验证计划与证据

1. 封面测试覆盖普通/加密格式、密钥/签名错误、目录坏图回退、未知ID、路径越界、并发缓存与无图。
2. 客户端测试覆盖静态图优先、静态存在不截视频、无图截帧限频、切游戏丢弃旧请求。
3. 预览测试覆盖多标签页并发、失败缓存、TTL边界、房间隔离与宽度合法性。
4. MV测试加入RAF与定时器错相、暂停/恢复、MZ ticker、上下文/音轨重建；启动参数不改变普通launch。
5. RGSS测试覆盖原生帧ACK/过期回调、无权限状态、最后消费者停止与observer共享；执行macOS原生构建/桥接smoke。
6. 两款实机游戏顺序运行，逐一对照各窗口状态与两分钟稳定性；手机未实际接入时不可报告已测Safari真机。

旧文档的20.5ms/64.8ms封面耗时、60FPS、4–8ms端到端和5–10%CPU没有本轮可复核采样，不作为已验收数据。最终交付只记录实际执行的命令与结果，并注明未完成的性能/设备验收。

## 9. 设计依据

- [W3C WebRTC接收器规范](https://www.w3.org/TR/webrtc/#dom-rtcrtpreceiver-jitterbuffertarget)：延迟目标受实现允许范围约束。
- [W3C WebRTC统计规范](https://www.w3.org/TR/webrtc-stats/)：RTT、解码和抖动缓冲的统计口径。
- [Apple ScreenCaptureKit示例](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos)：窗口filter、采集输出和配置。
- [Apple App Nap能效指南](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/PrioritizeWorkAtTheAppLevel.html)：activity用于描述任务，不等于固定CPU核心或帧率保证。

## 10. 本轮实现与验证记录

### 10.1 代码

- `services/game/cover.ts`：独立静态封面解析、路径/文件/解密校验、有界缓存与并发合并；封面接口保留真实API信封。
- `services/runtime/game-preview.ts`：基础房间180秒缓存，包含失败结果；读取已有RGSS低频图片，不能作为实时来源。
- `components/remote-play/InstancePreview.tsx`：静态封面失败后保持低频预览来源，下个刷新周期更新预览URL；不反复请求缺失封面。
- `plugins/mv/src/helpers/game/remote-stream.ts`：原生更新优先的补帧、保留音频图、AudioContext重建后替换音轨、最后媒体消费者退出时停止视频采集并还原补帧钩子。
- `plugins/rgss/native/window-capture.*`：ScreenCaptureKit内存采集、单帧ACK/超时、首帧超时、代次隔离、停止时释放activity。
- `plugins/rgss/src/window-frame-source.ts`、`spectator-peers.ts`：首个真实解码帧后建立视频，多个观看者共享帧源，观看通道只响应hello/ping，不转发控制指令。信令临时失败不主动销毁现有观看流。

### 10.2 原生证据与限制

`sh plugins/rgss/native/capture-smoke.sh`不启动游戏，仅创建一个短暂测试窗口。当前机器输出：

```text
Native capture: silent=0 frames=30 unique=30 dimensions=1 passed=1
Native capture: silent=1 frames=30 unique=30 dimensions=1 passed=1
```

两种状态均为544×416内容区域；这是连续更新与尺寸检查，不是游戏FPS或端到端延迟采样。作为对照，alpha=0离屏窗口只得到1个独特帧，因此宿主改为不透明离屏窗口。

原有`pnpm test:rgss:native`的界面命中、输入框Cmd+A和Enter检查通过，但同进程双WKWebView的DataChannel测试停在ICE checking。临时诊断仅将offer内的mDNS候选替换为本机实际局域网地址，随后DataChannel及其余检查通过；生产服务已有offer地址修正逻辑。该结果说明本机测试存在mDNS寻址问题，不能将未修改的完整命令记录为通过，也不修改生产环境为固定IP。

SDK头文件确认本进程窗口枚举API始于macOS14.4；旧系统权限分支尚未验证。真实MV/VX、手机Safari、两分钟稳定性、最小化/锁屏、RGSS声音、Windows/Linux视频后端与最终原生编码链路均保留为未验收。为避免用户机器继续卡顿，完成测试窗口退出与重复监听进程清理后，本轮不再启动真实游戏。

### 10.3 自动化检查

- 11个相关测试套件、69个测试通过，覆盖封面、预览缓存、MV补帧与音频生命周期、RGSS帧源与观看连接、WebRTC信令和接收端设置。
- `pnpm typecheck`通过，包含主应用、MV与RGSS插件。
- `pnpm build:plugins:mv`及`pnpm build:plugins:rgss`通过，后者包含macOS原生动态库构建。
- Ruby桥接语法、原生构建及采集smoke脚本的shell语法检查通过。
- 未执行完整生产构建及真实游戏压力测试；自动化结果不替代第10.2节列出的设备与性能验收。

### 10.4 主机窗口配置检查

- 新增「显示窗口 / 后台运行」与独立主机静音选项，接入全部10种语言。服务端持久化，串流启动读取服务端值；普通本地启动保持既有参数。
- 7个相关套件、64个测试通过，包含配置接口读写与非法数据、部分更新、保存失败与读取重试、MV/RGSS启动参数、运行实例复用、旧浏览器偏好隔离、音频环境清理，以及原有取消/重连和MV媒体生命周期回归。
- `pnpm typecheck`、本轮涉及的TypeScript文件ESLint、两处Ruby语法检查通过。
- 3000服务的设置页面与设置GET接口均返回200，默认值仍为 `windowed` / `muteHostAudio: true`；检查时运行实例为0。
- 本轮不启动真实游戏、不执行完整生产构建；后台与前台的FPS、CPU、内存、端到端延迟对照仍未测量。
