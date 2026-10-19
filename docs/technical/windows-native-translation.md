# Windows 本地离线翻译接入技术设计

- 日期：2026-10-19
- 状态：技术方案草案
- 需求文档：[Windows 本地离线翻译引擎接入需求](../windows-native-translation.md)

---

## 1. 整体架构与设计思路

由于 Windows 生态具备多样化的硬件（NPU、NVIDIA CUDA、AMD ROCm、Intel/DirectX），为保证在各种 PC 上的通用性与极致性能，设计 **“双层架构 + 统一步调接口”**：

```text
┌────────────────────────────────────────────────────────┐
│                   Chaya Node.js 运行时                   │
│                                                        │
│   services/translate/lib/windows-translate.ts          │
│   (管理 Windows 子进程、自适应模式探测、超时队列、语言映射)  │
└───────────────────────────┬────────────────────────────┘
                            │ stdin / stdout (JSON-Lines)
┌───────────────────────────▼────────────────────────────┐
│          native/bin/chaya-win-translator.exe           │
│          (独立 Windows 静态二进制，无 Python / 驱动依赖)   │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │ 探测器: 检测 Win11 24H2 NPU vs DirectML vs CPU  │   │
│   └───────────────────────┬────────────────────────┘   │
│                           │                            │
│         ┌─────────────────┴─────────────────┐          │
│         ▼                                   ▼          │
│   【通道 A: WinRT 原生】              【通道 B: DirectML】    │
│   Windows App SDK 1.6+              ONNX Runtime / CT2 │
│   (设备端 NPU 零显存占用)              (DX12 显卡/CPU 通用)  │
└────────────────────────────────────────────────────────┘
```

---

## 2. 协议设计与生命周期

与现有的 macOS `chaya-apple-translator` 保持完全对称的 `stdio (JSON-Lines)` 通信协议，Node.js 侧可复用大部分队列调度与状态管理逻辑。

### 2.1 请求消息格式

```json
// 探测当前设备环境与语言包状态
{ "id": "chk-1", "type": "check", "source": "ja", "target": "zh-Hans" }

// 翻译请求
{ "id": "trans-1", "type": "translate", "text": "こんにちは", "source": "ja", "target": "zh-Hans" }
```

### 2.2 响应消息格式

```json
// 探测响应：返回具体底层通道与状态
{
  "id": "chk-1",
  "success": true,
  "status": "ready",
  "backend": "winrt-npu", // "winrt-npu" | "directml-gpu" | "cpu-simd"
  "message": null
}

// 缺失语言包响应
{
  "id": "chk-1",
  "success": false,
  "status": "supported",
  "error": "not_installed",
  "backend": "winrt-npu",
  "message": "Language pack not installed in Windows Settings"
}
```

---

## 3. 核心技术实现细节

### 3.1 运行时自适应探测机制

在 `chaya-win-translator.exe` 启动时按以下优先顺序进行能力探测：

1. **Step 1: 检查 Windows 11 版本号**：
   - 检查 `RtlGetVersion` 是否 $\ge 10.0.26100$（Windows 11 24H2）。
   - 若满足，探测 `Windows.Media.Speech.Translation` 或系统级端侧模型可用性。
2. **Step 2: 检查 DirectML (DirectX 12) GPU 加速**：
   - 调用 `D3D12CreateDevice` 检查是否存在支持 Feature Level 11_0 以上的 GPU。
   - 若存在，初始化 DirectML 执行提供程序（DirectML Execution Provider），单句翻译延迟约 **25ms ~ 40ms**。
3. **Step 3: 兜底 CPU AVX2**：
   - 若为无独显且无 NPU 的老旧系统，以 CPU AVX2 / AVX-512 高效多线程模式运行。

### 3.2 语言代码对齐 (Language Mapping)

将 10 种语言映射至统一的 BCP-47 / NLLB 代码：

- `en` $
ightarrow$ `en-US` / `eng_Latn`
- `zh` $
ightarrow$ `zh-Hans` / `zho_Hans`
- `cht` $
ightarrow$ `zh-Hant` / `zho_Hant`
- `ja` $
ightarrow$ `ja-JP` / `jpn_Jpan`
- `ko` $
ightarrow$ `ko-KR` / `kor_Hang`
- `fr` $
ightarrow$ `fr-FR` / `fra_Latn`
- `de` $
ightarrow$ `de-DE` / `deu_Latn`
- `es` $
ightarrow$ `es-ES` / `spa_Latn`
- `ru` $
ightarrow$ `ru-RU` / `rus_Cyrl`
- `pt-BR` $
ightarrow$ `pt-BR` / `por_Latn`

---

## 4. 前端交互与系统引导设计

当 Windows 离线翻译返回 `not_installed` 或需要配置时：

- 弹出多语言引导模态框（与 macOS 保持统一的设计语言），针对不同底层动态提供说明：
  - **若为 WinRT 原生路径**：引导用户打开 Windows「设置」$
ightarrow$「时间和语言」$
ightarrow$「语言和区域」，下载对应的语言包与离线语音/翻译组件；
  - **若为通用离线模型包**：展示模型包下载进度条或安装指引。

---

## 5. 后续实施阶段规划

- **阶段一（当前）**：完成需求与架构设计，明确双轨制技术路线，统一接口契约。
- **阶段二**：搭建 Windows 独立二进制构建工程（MSVC / CMake 编译 `chaya-win-translator`）。
- **阶段三**：在实际 Windows 设备上进行 DirectML 性能调优、NPU 握手验证与全语向对齐测试。
