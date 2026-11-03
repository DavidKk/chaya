# 远程串流：全屏局内工作台、组件解耦与低功耗技术方案

- **日期**：2026-11-02
- **状态**：技术方案设计完成，待实施落地
- **对应需求**：[需求文档](../remote-play-overlay-workspace.md)
- **关联文档**：[串流静默与多实例技术方案](remote-play-silent-multi-instance.md) · [Chaya UI 风格指南](chaya-ui-style-guide.md)
- **有效范围**：`components/remote-play/` 目录结构重构与生命周期管理，涉及 `/play` 路由串流交互层。

---

## 1. 架构调整与组件分层

### 1.1 现状重构对照

| 维度             | 重构前（`RemoteCheatDrawer.tsx`）                       | 重构后（`components/remote-play/workspace/`）                               |
| :--------------- | :------------------------------------------------------ | :-------------------------------------------------------------------------- |
| **容器模式**     | 固定宽高比居中 Modal，小屏高度被内外边距和黑边挤压      | 全屏铺满式 Sheet (`fixed inset-0`)，Safe-Area 贴边                          |
| **职责耦合**     | 修改、调试工具箱、日志流三者杂糅在一个 700 行文件内     | 拆分为 `RemoteWorkspaceModal` 外壳 + 3 个专属功能子面板                     |
| **日志监听**     | 组件 mount 阶段即开启 `subscribe`，关闭时持续 re-render | **仅在 `RemoteLogsPanel` 挂载且激活时订阅**，切走/关闭立即注销              |
| **DOM 生命周期** | 依靠 CSS 显示隐藏或受限条件渲染                         | 外部统一控制 `unmountOnExit`，关闭时彻底销毁 DOM 节点                       |
| **视觉风格**     | 临时 Tailwind 类（`bg-neutral-900`, `rounded-lg`）      | 统一 Chaya Design System 主题（`bg-paper`, `border-line`, `components/sk`） |

### 1.2 目标目录与模块划分

```text
components/remote-play/workspace/
├── index.ts                     # 统一导出
├── types.ts                     # 工作台 Props 与 Tab 类型定义
├── RemoteWorkspaceModal.tsx     # 全屏 Safe-Area 容器、头部导航与路由外壳
├── RemoteCheatsPanel.tsx        # 常用修改面板（卡死自救、状态开关、倍速、存档）
├── RemoteDebugPanel.tsx         # 串流调试面板（链路质量、Eruda、性能 HUD、Mac 命令）
└── RemoteLogsPanel.tsx          # 运行日志面板（按需流式订阅、级别筛选、JSON 查看、上报）
```

---

## 2. 详细设计与核心实现

### 2.1 全屏 Safe-Area 贴边容器（`RemoteWorkspaceModal.tsx`）

为消除小弹窗对手机横屏高度的严重挤压，容器设计为全屏覆盖，并通过内联样式精确适配 iOS 安全区域：

```tsx
<div
  className="fixed inset-0 z-50 flex flex-col bg-paper/95 text-ink backdrop-blur-md transition-opacity select-none"
  style={{
    paddingTop: 'max(0.5rem, env(safe-area-inset-top))',
    paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
    paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
    paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
    overscrollBehavior: 'contain',
    touchAction: 'pan-y',
  }}
  onPointerDown={(e) => e.stopPropagation()}
  onPointerMove={(e) => e.stopPropagation()}
  onPointerUp={(e) => e.stopPropagation()}
  onTouchStart={(e) => e.stopPropagation()}
  onTouchMove={(e) => e.stopPropagation()}
  onClick={(e) => e.stopPropagation()}
>
  {/* 极简头部条：固定 40px 高度 */}
  <header className="flex h-10 shrink-0 items-center justify-between border-b border-line/40 px-2">
    {/* 返回 / 关闭按钮 */}
    {/* 标题与 Tab 切换指示器 */}
    {/* 右侧动作区 */}
  </header>

  {/* 主视区：贴边自适应滚动 */}
  <main className="flex-1 min-h-0 overflow-hidden">
    {activeTab === 'cheats' && <RemoteCheatsPanel {...cheatsProps} />}
    {activeTab === 'debug' && <RemoteDebugPanel {...debugProps} />}
    {activeTab === 'logs' && <RemoteLogsPanel {...logsProps} />}
  </main>
</div>
```

### 2.2 常用修改面板（`RemoteCheatsPanel.tsx`）

- **横竖屏适配策略**：
  - 横屏（高度狭窄）：采用双列网格（`grid grid-cols-2 gap-3`），左列放「卡死急救与剧情推进」，右列放「状态开关与倍速辅助」。
  - 竖屏：单列纵向流式，使用 `<ScrollArea>` 弹性滚动。
- **组件统一**：
  - 开关项统一封装复用 `ConfigRow` 组件，保持左标题+右控件的标准对齐规范。
  - 急救动作采用 `Button size="sm" variant="accent"` / `variant="fail"` 鲜明指示。

### 2.3 串流调试面板（`RemoteDebugPanel.tsx`）

- **职责收敛**：仅展示真机网络与硬件解码状态，以及移动端必备的调优开关。
- **指标项**：
  - 链路状态：连接态徽标、RTT 往返时延（ms）。
  - 视频画幅：宽 × 高。
  - 客户端：系统与浏览器标识。
  - 解码加速：H.264 硬件解码支持态。
- **工具项**：
  - Eruda 控制台：调用 `initErudaMobileDevTools()` / `destroyErudaMobileDevTools()`。
  - 性能 HUD：切换悬浮状态。
  - 监视终端：一键复制 `curl -N "http://<IP>:3000/api/logs/stream?source=remote-play"`。

### 2.4 运行日志面板与低功耗订阅（`RemoteLogsPanel.tsx`）

#### 核心生命周期（按需订阅与注销）

```tsx
export function RemoteLogsPanel() {
  const [logs, setLogs] = useState<RemotePlayLogEntry[]>([])

  useEffect(() => {
    // 1. 仅在日志面板挂载展示时拉取最新快照并订阅增量
    setLogs(remotePlayLogger.getRecentLogs().slice(-100))
    const unsubscribe = remotePlayLogger.subscribe((allLogs) => {
      // 强制内存截断，保持最新 100 条环形缓冲区
      setLogs(allLogs.slice(-100))
    })

    // 2. 一旦切换 Tab 或关闭工作台，立即取消订阅，切断 state 刷新
    return () => {
      unsubscribe()
    }
  }, [])

  // 渲染极简全屏日志流与语法高亮标签
}
```

---

## 3. UI 规范与 Design System 对齐

按 `docs/technical/chaya-ui-style-guide.md` 要求对齐：

1. **色彩与背景**：
   - 背景底色：统一使用 `bg-paper`（95% 不透明度配合系统毛玻璃 `backdrop-blur-md`）。
   - 边框线色：统一使用 `border-line` 或半透明 `border-line/40`。
   - 强调色：采用全局 `accent`（绿色/品牌青）与 `fail`（红色/急救报警）。
2. **组件规范**：
   - 按钮采用 `components/sk/Button`，避免手写 Tailwind 拼接按钮。
   - 徽标采用 `components/sk/Badge`（`tone="ok" | "warn" | "neutral"`）。
   - 滚动容器采用 `components/sk/ScrollArea`，确保滚动条紧贴边界，不占额外内边距。

---

## 4. 多语言（i18n）架构

所有文案收敛至 `lib/i18n/messages/parts/play.ts`：

- `play.workspace.title`: 工作台标题
- `play.workspace.tabCheats`: 常用修改
- `play.workspace.tabDebug`: 串流调试
- `play.workspace.tabLogs`: 运行日志
- 调试与急救相关文案保持全量 10 种语言对应键值，禁止任何直接内联中文字符串。

---

## 5. 测试与验证方案

1. **单元测试与挂载验证**（`__tests__/components/remote-play/workspace.spec.tsx`）：
   - 验证 `RemoteWorkspaceModal` 在 `open={false}` 时返回 `null`，DOM 树为 0 节点；
   - 验证打开工作台切换至 `logs` Tab 时触发 `remotePlayLogger.subscribe`，切回 `cheats` 或关闭时触发 `unsubscribe`；
   - 验证横竖屏状态下布局类的正确切换；
   - 验证急救动作通过 `onSend` 正确下发 `op: 'runAction', id: 'fix:unstuck'` 等指令。
2. **全流程质量门禁**：
   - `pnpm lint:check` 保持 0 警告 0 报错；
   - `pnpm typecheck` 保持零类型错误；
   - 全量 486 个测试套件保持 100% 通过。
