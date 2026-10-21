# Linux 本地离线翻译接入技术设计

- 日期：2026-10-19
- 状态：Bergamot 基础接入；后文为目标设计，尚未全部实现
- 需求文档：[Linux 本地离线翻译工具接入需求](../linux-offline-translation.md)

---

## 当前接入与使用

已接入引擎开关、实时翻译与 seed 补译共用链路、缓存来源筛选、十种界面语言标签。引擎默认关闭，在翻译引擎的系统组中启用 Bergamot。运行时不需要 Python 或 GPU。

### 编译原生程序

Linux/macOS 安装 Git、CMake（3.24+）、C++17 编译器和 PCRE2（8-bit）开发库。Linux 还需要 CPU BLAS 开发库（例如 OpenBLAS），macOS 使用系统 Accelerate。然后执行：

```sh
pnpm build:bergamot
```

首次构建需要联网拉取固定版本的 [Bergamot 源码](https://github.com/browsermt/bergamot-translator/tree/9271618ebbdc5d21ac4dc4df9e72beb7ce644774) 及其依赖，输出到 `native/bin/linux-{arch}/chaya-bergamot-translator` 或 `native/bin/macos-{arch}/chaya-bergamot-translator`。普通 `pnpm build` 不自动下载和编译这个可选引擎；打包 Electron 前先构建，打包脚本会复制 `native/bin/`。跨架构安装包须预先提供对应架构产物。当前脚本使用本机工具链，不保证 Musl 全静态链接或所有发行版兼容性。

程序探测顺序：`CHAYA_BERGAMOT_BINARY`、平台/架构目录、`native/bin/chaya-bergamot-translator`、`~/.local/bin/`、PATH。只接受本项目 JSON-Lines 协议的 `chaya-bergamot-translator`；上游一次性 CLI 不能直接代替。

固定版本的上游依赖有新版 Clang 兼容问题：构建配置在 macOS 为 zlib 保留真实 `fdopen`，在 Clang 16+ 将 SentencePiece 训练代码中的越界枚举哨兵从 `constexpr` 改为 `const`，并仅对 Marian 堆栈回溯源文件放宽变长数组警告。修改作用于构建缓存中的依赖，不修改系统 SDK。

2026-10-20 已在 macOS arm64 完成原生编译和 Node → JSON-Lines → Bergamot 的真实模型验证：英语 `Hello, world!` 输出德语 `Hallo, Welt!`，状态分别正确返回 `ready` 和 `model_pack_missing`。Linux 实机与其它架构尚未验收。

### 安装语言包

从模型发布方取得兼容 Bergamot/Marian 的模型、词表及配置，将每个方向放在独立目录：

```text
${XDG_DATA_HOME:-$HOME/.local/share}/chaya/translation-packs/
  en_zh/
    config.yml
    ... config.yml 引用的模型、词表及其他文件
  ja_zh/
    config.yml
    ...
```

可用 `CHAYA_BERGAMOT_PACKS_DIR` 覆盖语言包根目录。`config.yml` 必须使用发布方提供的匹配配置，启用 `relative-paths: true`，并正确引用同目录文件；不能只改模型文件后缀。语言对不做自动下载或英语中转，双向翻译需分别安装两个方向。十种 UI 语言不代表上游模型支持全部语言对。模型体积、内存和时延取决于实际语言包与硬件，后文数值仅为目标，尚无实测保证。

### HTTP 接口

向本机 `POST /api/translate` 发送：

```json
{ "mode": "bergamot-status", "from": "en", "to": "zh" }
```

返回 `status: ready | model_pack_missing | unavailable` 和 `installed`；找到配置后会尝试加载模型，损坏或缺少权重不算 ready。

```json
{ "mode": "bergamot", "from": "en", "to": "zh", "text": "Welcome to the kingdom." }
```

翻译与状态检查均使用 5 秒看门狗；超时会终止进程并拒绝该进程的全部待处理请求，下次请求重启。空闲 60 秒释放进程。首次加载较大模型也计入超时。仅本机服务支持这些接口，沿用现有访问控制。

尚未实现：语言包一键下载与 UI 引导、MCP 专用就绪工具、Windows 原生翻译、发行版兼容矩阵和性能验收。

---

## 1. 技术选型与工具对比

在遵循“**工具级优先、零复杂环境依赖、极速轻量**”的前提下，对 Linux 端可选的开源离线翻译组件进行评估。Bergamot 同时适用于 Linux 与 macOS：Linux 使用 CPU SIMD，macOS 使用 Apple Accelerate；macOS 仍优先调用 Apple Translation Framework，Bergamot 用于跨平台统一备用能力。

| 选型方案                                | 底层引擎                            | 语言包体积       | 内存峰值     | CPU 优化                  | 评估结论                                                               |
| :-------------------------------------- | :---------------------------------- | :--------------- | :----------- | :------------------------ | :--------------------------------------------------------------------- |
| **Bergamot (Mozilla Translations)**     | Marian C++ (8-bit 量化)             | 15MB ~ 30MB / 对 | 40MB ~ 80MB  | AVX2 / NEON SIMD 极速优化 | **推荐首选**：Firefox 官方同源，纯 C++ 单二进制，无 Python 环境依赖    |
| **Argos Translate / LibreTranslate**    | OpenNMT-py (CTranslate2 C++ 运行时) | 40MB ~ 80MB / 对 | 80MB ~ 150MB | x86_64 / aarch64 CPU 优化 | **备选/双轨支持**：生态模型覆盖全，通过 PyInstaller 固化为单一执行程序 |
| **Apertium**                            | 纯规则与词典形态学 (RBMT)           | 5MB ~ 10MB / 对  | < 20MB       | 纯 CPU 规则匹配           | 语言对覆盖不均，亚洲语系（如日-中）效果较弱，不作为通用主力            |
| **本地大模型 (Ollama / Qwen2.5 / LLM)** | Transformer GGUF / SafeTensors      | 2GB ~ 8GB+       | 4GB ~ 16GB   | 依赖 GPU/CUDA 或大量内存  | **不属于工具级**：列入后续二期高阶润色模型演进，不在本期范围           |

**推荐实施路线**：

- 采用 **Bergamot C++ 静态编译单二进制文件**，按平台产出 `native/bin/linux-{arch}/chaya-bergamot-translator` 与 `native/bin/macos-{arch}/chaya-bergamot-translator`。
- Linux 版本运行时零外部动态链接依赖（Musl libc 静态编译），可在常见 Linux 发行版（Ubuntu 18.04+、Debian、Fedora、Arch Linux、Alpine、SteamOS）开箱即用；macOS 版本使用 Apple Accelerate，并分别提供 Apple Silicon 与 Intel 架构构建产物。

---

## 2. 系统整体架构

```text
┌────────────────────────────────────────────────────────┐
│                   Chaya Node.js 运行时                   │
│                                                        │
│   services/translate/lib/bergamot-translate.ts         │
│   (子进程生命周期管理、长连接守护管道、超时防死锁看门狗)    │
└───────────────────────────┬────────────────────────────┘
                            │ stdin / stdout (JSON-Lines)
┌───────────────────────────▼────────────────────────────┐
│      native/bin/{platform}-{arch}/chaya-bergamot-translator │
│      (纯 C++ 静态编译程序，内嵌 Marian-NMT 8-bit 量化内核)│
│                                                        │
│   ┌──────────────────────┐  ┌──────────────────────┐   │
│   │   AVX2/NEON SIMD     │  │  轻量语言对数据包目录    │   │
│   │   CPU 8-bit 极速推理  │  │  (~/.local/share/chaya) │   │
│   └──────────────────────┘  └──────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

---

## 3. 三端统一离线翻译抽象层设计

为了使 Web 控制台和批量管线无感知调用不同操作系统的原生/工具级翻译，设计统一的抽象服务接口：

```typescript
// services/translate/lib/offline/types.ts

export type OfflineTranslatorEngineType = 'apple' | 'windows-winrt' | 'windows-directml' | 'bergamot'

export interface OfflineTranslateRequest {
  text: string
  from: string // e.g. 'en', 'zh', 'ja', 'ko'
  to: string
  context?: string
}

export interface OfflineTranslateResponse {
  translatedText: string
  engine: OfflineTranslatorEngineType
  durationMs: number
}

export interface OfflineTranslatorProvider {
  readonly platform: 'darwin' | 'win32' | 'linux'
  isAvailable(): Promise<boolean>
  checkLanguagePair(from: string, to: string): Promise<{ supported: boolean; packInstalled: boolean }>
  translate(req: OfflineTranslateRequest): Promise<OfflineTranslateResponse>
}
```

---

## 4. 进程通信协议规范 (IPC)

Node.js 主进程与 `chaya-bergamot-translator` 之间通过标准输入输出（`stdin` / `stdout`）采用换行分隔的 JSON 字符串（JSON-Lines）进行长连接无状态请求通信：

### 4.1 检查语言包支持 (`check`)

- **Request (stdin)**:
  ```json
  { "id": "req-01", "action": "check", "from": "en", "to": "zh" }
  ```
- **Response (stdout)**:
  ```json
  { "id": "req-01", "success": true, "installed": true, "path": "/home/user/.local/share/chaya/packs/en_zh" }
  ```

### 4.2 翻译请求 (`translate`)

- **Request (stdin)**:
  ```json
  { "id": "req-02", "action": "translate", "from": "en", "to": "zh", "text": "Welcome to the kingdom." }
  ```
- **Response (stdout)**:
  ```json
  { "id": "req-02", "success": true, "translatedText": "欢迎来到王国。", "durationMs": 16 }
  ```

### 4.3 错误响应 (`error`)

- **Response (stdout)**:
  ```json
  { "id": "req-03", "success": false, "error": "Language pack for ja -> zh not found in local data directory" }
  ```

---

## 5. 语言代码映射规范

| Chaya 内部代码 | 语言名称                         | Bergamot 翻译包代码 | ISO 639-1 |
| :------------- | :------------------------------- | :------------------ | :-------- |
| `en`           | 英语 (English)                   | `en`                | `en`      |
| `zh`           | 简体中文 (Chinese Simplified)    | `zh`                | `zh-CN`   |
| `cht`          | 繁体中文 (Chinese Traditional)   | `zh-TW`             | `zh-TW`   |
| `ja`           | 日语 (Japanese)                  | `ja`                | `ja`      |
| `ko`           | 韩语 (Korean)                    | `ko`                | `ko`      |
| `fr`           | 法语 (French)                    | `fr`                | `fr`      |
| `de`           | 德语 (German)                    | `de`                | `de`      |
| `es`           | 西班牙语 (Spanish)               | `es`                | `es`      |
| `ru`           | 俄语 (Russian)                   | `ru`                | `ru`      |
| `pt-BR`        | 巴西葡萄牙语 (Portuguese Brazil) | `pt`                | `pt-BR`   |

---

## 6. 异常处理与看门狗机制

1. **子进程崩溃自动重启**：
   - 监听 `child_process.on('exit')`，若非正常退出，自动回收资源并在下次请求时热拉起新实例。
2. **请求级看门狗超时机制**：
   - 单条翻译请求设定 **5000ms 超时限制**。若超时未响应，中断 Promise 并向调用方返回明确错误：
     `"Offline translation timeout: bergamot did not respond within 5000ms"`。
3. **接口报错全英文规范**：
   - 所有 IPC 接口内部异常、Node.js 服务端日志、MCP 返回结果**严守全英文规范**。
   - 前端 Web 界面若捕获到包未下载错误，转换显示对应本地化语言的引导弹窗。
