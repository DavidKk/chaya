# Chaya Apple 原生翻译引擎接入技术设计

- 日期：2026-10-18
- 状态：技术方案评审
- 需求文档：[Apple 原生离线翻译接入需求](../apple-native-translation.md)

## 1. 概述与背景

在 macOS 15+（Sequoia 及以上）系统中，Apple 推出了面向第三方的 `Translation` 原生系统框架（`import Translation`）。该框架基于 Apple 芯片的 Neural Engine (ANE) 进行设备端硬件加速推理，支持纯离线环境下的高效神经机器翻译。

本技术方案旨在将 Apple 原生翻译接入 Chaya 的翻译引擎架构中，作为云端翻译服务之后的**零网络依赖、零成本、毫秒级离线兜底引擎**。

---

## 2. 架构设计与运行时桥接

### 2.1 架构分层

Chaya 是基于 Node.js / Next.js 的 TypeScript 项目，无法直接以 in-process 方式执行 Swift 的原生系统框架。为了兼顾**高吞吐性能**与**系统稳定性**，采用 **常驻 Daemon (stdio JSON-Lines 协议)** 架构：

```text
┌────────────────────────────────────────────────────────┐
│                   Chaya Node.js 运行时                   │
│                                                        │
│   services/translate/lib/macos-translate.ts            │
│   (管理子进程生命周期、请求队列缓冲、超时控制、语言检测)      │
└───────────────────────────┬────────────────────────────┘
                            │ stdin / stdout (JSON-Lines)
┌───────────────────────────▼────────────────────────────┐
│          native/bin/chaya-apple-translator             │
│          (轻量 Swift 编译二进制，常驻后台 Daemon)          │
│                                                        │
│   • TranslationSession Actor (串行任务调度)             │
│   • LanguageAvailability 语言状态与离线包探测           │
│   • Session 语向复用缓存 (ja->zh, en->zh 等)             │
│   • Apple Neural Engine (ANE) 设备端硬件推理           │
└────────────────────────────────────────────────────────┘
```

### 2.2 通信协议设计 (JSON-Lines / stdio)

Node.js 主进程与 Swift 子进程之间通过标准输入输出交互，每行一个独立的 JSON 结构，避免冷启动与粘包问题。

#### 请求格式 (Request)

```json
// 翻译请求
{ "id": "req-1", "type": "translate", "text": "こんにちは", "source": "ja", "target": "zh-Hans" }

// 语言包可用性探测请求
{ "id": "req-2", "type": "check", "source": "ja", "target": "zh-Hans" }
```

#### 响应格式 (Response)

```json
// 翻译成功
{ "id": "req-1", "success": true, "result": "你好" }

// 翻译失败（如未安装离线语言包）
{ "id": "req-1", "success": false, "error": "not_installed", "message": "Language pack not installed on device" }

// 探测结果
{ "id": "req-2", "success": true, "status": "installed" } // installed | supported | unsupported
```

---

## 3. 核心优化与技术实现细节

### 3.1 进程生命周期与惰性启动 (Lazy Daemon)

- **按需加载**：只有当流水线中需要使用 `apple` 引擎时，Node.js 侧才启动 `chaya-apple-translator` 进程。
- **空闲超时与自动回收**：无翻译任务超过 60 秒后，自动发送退出信号回收进程释放系统内存；下次需要时自动重新拉起。
- **异常恢复**：若 Swift 进程意外退出，Node 侧捕获 `exit` 事件并清空挂起请求，下一次请求重新拉起并自动重试。

### 3.2 串行任务队列与并发安全 (Swift Actor)

- Apple Translation Framework 的同一个 `TranslationSession` 并发发起 `translate()` 容易导致底层排队冲突或异常。
- Swift 端使用 `actor TranslationCoordinator` 严格维护串行队列，逐条消费翻译请求并即时 flush stdout。

### 3.3 语向 Session 缓存

- 跨语向（如 `ja->zh` 变为 `en->zh`）切换时，重新初始化 Session 存在一次性微小开销。
- Swift 内部使用字典 `[String: TranslationSession]` 缓存已加载的语向会话，避免频繁重建。

### 3.4 语言代码规范化映射 (Language Mapping)

Chaya 项目内部使用的语言代码与 Apple Translation 的 BCP-47 标识符对齐映射：

```ts
export const CHAYA_TO_APPLE_LANG_MAP: Record<string, string> = {
  ja: 'ja',
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  en: 'en',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
  it: 'it',
}
```

---

## 4. 引擎集成与代码改动点

### 4.1 引擎定义扩展 (`lib/translate/engines.ts`)

1. **引擎标识**：`TRANSLATE_ENGINE_IDS` 扩展为 `['bing', 'google', 'apple'] as const`。
2. **默认开关**：
   ```ts
   export const DEFAULT_ENGINE_SWITCHES: TranslateEngineSwitches = {
     bing: true,
     google: true,
     apple: typeof process !== 'undefined' && process.platform === 'darwin',
   }
   ```
3. **平台安全校验**：在非 macOS 环境下，`isBuiltinEngineId('apple')` 依然合法，但执行器层自动拦截。

### 4.2 执行层接入 (`services/translate/lib/engines.ts`)

- 新增 `appleTranslate(text: string, options?: { source?: string; target?: string }): Promise<string>`。
- 在 `services/translate/lib/engines.ts` 的批处理调度中，作为 `platform` 组的末位兜底。

### 4.3 优雅降级与错误处理 (Graceful Degradation)

- **`not_installed` 错误**：当检测到当前语向离线包未下载时，记录轻量警告并返回错误，外层 store-queue 自动视该词条为该引擎失败，交由其他引擎或保留为未翻译状态，**严禁阻塞或崩溃流水线**。
- **空文本 / 非法字符**：直接返回原文本或快速跳过，不产生 IPC 通信开销。

---

## 5. 源码目录与编译部署策略

### 5.1 目录组织

```text
native/
├── apple-translator/
│   ├── main.swift             # Swift 源码 (Daemon 与 Translation 交互)
│   └── build.sh               # 独立编译脚本 (swiftc 编译)
└── bin/
    └── .gitkeep               # 编译产物输出目录（可执行文件加入 .gitignore）
```

### 5.2 编译与构建接入

- 编译命令：
  ```bash
  swiftc -O -parse-as-library native/apple-translator/main.swift -o native/bin/chaya-apple-translator
  ```
- 在 `package.json` 的 `scripts` 中增加：
  - `"build:native"`: `"sh native/apple-translator/build.sh"`
  - 并在 macOS 构建流程中按需触发。如果本地缺少 swiftc，则优雅降级（不阻断普通构建，仅禁用 apple 离线引擎）。

---

## 6. 测试与验证方案

1. **单元测试与协议测试**：通过 Node.js 脚本直接 mock 子进程 stdio，测试 `macos-translate.ts` 的请求匹配、队列缓冲和超时处理。
2. **端到端基准延迟测试**：
   - 连续发送 100 句游戏日常对话，测试平均吞吐量与单句延迟（预期单句 ≤ 20ms）。
3. **异常场景验证**：
   - 未安装离线语言包场景（如故意请求未下载的语向），验证系统提示与回退机制。
   - 子进程崩溃自愈测试（手动 `kill` 子进程后紧接着发起新请求）。
