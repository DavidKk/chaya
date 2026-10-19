# Linux 本地离线翻译接入技术设计

- 日期：2026-10-19
- 状态：技术方案草案
- 需求文档：[Linux 本地离线翻译工具接入需求](../linux-offline-translation.md)

---

## 1. 技术选型与工具对比

在遵循“**工具级优先、零复杂环境依赖、极速轻量**”的前提下，对 Linux 端可选的开源离线翻译组件进行评估：

| 选型方案                                | 底层引擎                            | 语言包体积       | 内存峰值     | CPU 优化                  | 评估结论                                                               |
| :-------------------------------------- | :---------------------------------- | :--------------- | :----------- | :------------------------ | :--------------------------------------------------------------------- |
| **Bergamot (Mozilla Translations)**     | Marian C++ (8-bit 量化)             | 15MB ~ 30MB / 对 | 40MB ~ 80MB  | AVX2 / NEON SIMD 极速优化 | **推荐首选**：Firefox 官方同源，纯 C++ 单二进制，无 Python 环境依赖    |
| **Argos Translate / LibreTranslate**    | OpenNMT-py (CTranslate2 C++ 运行时) | 40MB ~ 80MB / 对 | 80MB ~ 150MB | x86_64 / aarch64 CPU 优化 | **备选/双轨支持**：生态模型覆盖全，通过 PyInstaller 固化为单一执行程序 |
| **Apertium**                            | 纯规则与词典形态学 (RBMT)           | 5MB ~ 10MB / 对  | < 20MB       | 纯 CPU 规则匹配           | 语言对覆盖不均，亚洲语系（如日-中）效果较弱，不作为通用主力            |
| **本地大模型 (Ollama / Qwen2.5 / LLM)** | Transformer GGUF / SafeTensors      | 2GB ~ 8GB+       | 4GB ~ 16GB   | 依赖 GPU/CUDA 或大量内存  | **不属于工具级**：列入后续二期高阶润色模型演进，不在本期范围           |

**推荐实施路线**：

- 采用 **Bergamot C++ 静态编译单二进制文件**（`native/bin/linux-x64/chaya-linux-translator` 及 `linux-arm64`）。
- 运行时零外部动态链接依赖（Musl libc 静态编译），可在任意 Linux 发行版（Ubuntu 18.04+、Debian、Fedora、Arch Linux、Alpine、SteamOS）开箱即用。

---

## 2. 系统整体架构

```text
┌────────────────────────────────────────────────────────┐
│                   Chaya Node.js 运行时                   │
│                                                        │
│   services/translate/lib/linux-translate.ts            │
│   (子进程生命周期管理、长连接守护管道、超时防死锁看门狗)    │
└───────────────────────────┬────────────────────────────┘
                            │ stdin / stdout (JSON-Lines)
┌───────────────────────────▼────────────────────────────┐
│      native/bin/linux-{arch}/chaya-linux-translator    │
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

export type OfflineTranslatorEngineType = 'apple' | 'windows-winrt' | 'windows-directml' | 'linux-bergamot'

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

Node.js 主进程与 `chaya-linux-translator` 之间通过标准输入输出（`stdin` / `stdout`）采用换行分隔的 JSON 字符串（JSON-Lines）进行长连接无状态请求通信：

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

| Chaya 内部代码 | 语言名称                         | Linux 翻译包代码 (Bergamot) | ISO 639-1 |
| :------------- | :------------------------------- | :-------------------------- | :-------- |
| `en`           | 英语 (English)                   | `en`                        | `en`      |
| `zh`           | 简体中文 (Chinese Simplified)    | `zh`                        | `zh-CN`   |
| `cht`          | 繁体中文 (Chinese Traditional)   | `zh-TW`                     | `zh-TW`   |
| `ja`           | 日语 (Japanese)                  | `ja`                        | `ja`      |
| `ko`           | 韩语 (Korean)                    | `ko`                        | `ko`      |
| `fr`           | 法语 (French)                    | `fr`                        | `fr`      |
| `de`           | 德语 (German)                    | `de`                        | `de`      |
| `es`           | 西班牙语 (Spanish)               | `es`                        | `es`      |
| `ru`           | 俄语 (Russian)                   | `ru`                        | `ru`      |
| `pt-BR`        | 巴西葡萄牙语 (Portuguese Brazil) | `pt`                        | `pt-BR`   |

---

## 6. 异常处理与看门狗机制

1. **子进程崩溃自动重启**：
   - 监听 `child_process.on('exit')`，若非正常退出，自动回收资源并在下次请求时热拉起新实例。
2. **请求级看门狗超时机制**：
   - 单条翻译请求设定 **5000ms 超时限制**。若超时未响应，中断 Promise 并向调用方返回明确错误：
     `"Offline translation timeout: linux-bergamot did not respond within 5000ms"`。
3. **接口报错全英文规范**：
   - 所有 IPC 接口内部异常、Node.js 服务端日志、MCP 返回结果**严守全英文规范**。
   - 前端 Web 界面若捕获到包未下载错误，转换显示对应本地化语言的引导弹窗。
